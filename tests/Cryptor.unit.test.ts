import Crypto from '../src/Crypto'
import { Buffer } from 'buffer/'

describe('Crypto class', () => {

  describe('Syncronous tests', () => {
    // Define initialization vector for all tests
    let initVector: Buffer
    let key: Buffer
    let crypto: Crypto

    beforeEach(() => {
      // Create the cryptor
      key = Buffer.from('very password')
      crypto = new Crypto(key)
      initVector = crypto.getInitVector()
    })
    test('Crypto - initialisation', () => {
      expect(crypto).toBeInstanceOf(Crypto)
    })
    test('Crypto - encrypt sync', () => {
      let cryptor2 = new Crypto(key, initVector)
      let plaintext = 'very important secret'

      let cipherText = crypto.encryptSync(plaintext)
      let cipherText2 = cryptor2.encryptSync(plaintext)

      // TODO: we have the iv, passworkd/key, and block mode
      // the ciphertext can be verfied independenly of this
      // we should assert it is equal to the cipher from a diff source
      expect(cipherText).not.toStrictEqual(plaintext)
      const decryptedTextSync = crypto.decryptSync(cipherText).toString()
      const decryptedTextSync2 = cryptor2.decryptSync(cipherText2).toString()
      expect(decryptedTextSync).toEqual(decryptedTextSync2)
      // same cipher when plaintext encrypted with constance iv
      expect(cipherText).toStrictEqual(cipherText2)
    })
    test('decrypt - sync', () => {
      let plainBuf = Buffer.from('very important secret')

      let cipherText = crypto.encryptSync(plainBuf)
      let deciphered = crypto.decryptSync(cipherText)

      expect(deciphered).toEqual(plainBuf)
    })
  })

  describe('Asyncronous tests', () => {
    // Define initialization vector for all tests
    let initVector: Buffer
    let key: Buffer
    let crypto: Crypto

    beforeEach(() => {
      // Create the cryptor
      key = Buffer.from('very password')
      crypto = new Crypto(key)
      initVector = crypto.getInitVector()
    })
    test('encrypt - async', async done => {
      let cryptoSync = new Crypto(key, initVector)

      let plainBuf = Buffer.from('very important secret')

      let cipherBufSync = cryptoSync.encryptSync(plainBuf)

      const cipherBuf = await crypto.encrypt(plainBuf)
      expect(cipherBuf).not.toEqual(plainBuf)

      const decryptedBufSync = crypto.decryptSync(cipherBuf)
      expect(decryptedBufSync).toEqual(plainBuf)
      // cipher same as when using sync fn
      expect(cipherBuf).toStrictEqual(cipherBufSync)
      done()
    })

    test('encryption and decryption are consistent async', async done => {
      let plainBuf = Buffer.from('very important secret')

      let cipherBuf = crypto.encryptSync(plainBuf)

      const deciphered = await crypto.decrypt(cipherBuf)
      expect(deciphered).toStrictEqual(plainBuf)
      expect(cipherBuf).not.toEqual(plainBuf)
      done()
    })

    test('encryption and decryption do not throw errors - async', async () => {
      expect(async () => {
        let plainBuf = Buffer.from('very important secret')

        const cipherBuf = await crypto.encrypt(plainBuf)

        const decryptedBuf = await crypto.decrypt(cipherBuf)
        expect(decryptedBuf).toStrictEqual(plainBuf)
      }).not.toThrow()
    })
  })

  describe('Webworker tests', () => {
    // Define initialization vector for all tests
    let initVector: Buffer
    let key: Buffer
    let crypto: Crypto
    beforeEach(() => {
      // Create the cryptor
      key = Buffer.from('very password')
      crypto = new Crypto(key, undefined, undefined, true)
      initVector = crypto.getInitVector()
    })

    test('can use webworkers - async', async done => {
      const plainBuf = Buffer.from('some plaintext')

      const cipherBuf = await crypto.encrypt(plainBuf)

      const decryptedBuf = await crypto.decrypt(cipherBuf)

      expect(decryptedBuf).toEqual(plainBuf)
      expect(decryptedBuf).not.toEqual(cipherBuf)
      done()
    })
  })
})
