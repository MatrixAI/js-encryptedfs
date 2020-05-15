import Crypto from '../src/Crypto'
import * as nodeCryptoLib from 'crypto'

describe('Crypto class', () => {

  describe('Syncronous tests', () => {
    let key: Buffer
    let crypto: Crypto

    beforeEach(() => {
      // Create the cryptor
      key = Buffer.from('very password')
      crypto = new Crypto(key, nodeCryptoLib)
    })
    test('Crypto - initialisation', () => {
      expect(crypto).toBeInstanceOf(Crypto)
    })
    test('Crypto - encrypt sync', () => {
      let cryptor2 = new Crypto(key, nodeCryptoLib)
      let plaintext = Buffer.from('very important secret')

      let chunk1 = crypto.encryptBlockSync(plaintext)
      let chunk2 = cryptor2.encryptBlockSync(plaintext)

      const decryptedText1 = crypto.decryptChunkSync(chunk1).toString()
      const decryptedText2 = cryptor2.decryptChunkSync(chunk2).toString()
      expect(decryptedText1).toEqual(decryptedText2)
    })
    test('decrypt - sync', () => {
      let plainBuf = Buffer.from('very important secret')

      let cipherText = crypto.encryptBlockSync(plainBuf)
      let deciphered = crypto.decryptChunkSync(cipherText)

      expect(deciphered).toEqual(plainBuf)
    })
  })

  describe('Asyncronous tests', () => {
    let key: Buffer
    let crypto: Crypto

    beforeEach(() => {
      // Create the cryptor
      key = Buffer.from('very password')
      crypto = new Crypto(key, nodeCryptoLib)
    })
    test('encrypt - async', async done => {
      const cryptoSync = new Crypto(key, nodeCryptoLib)

      const plainBuf = Buffer.from('very important secret')

      const cipherBufSync = cryptoSync.encryptBlockSync(plainBuf)
      const decryptedBufSync = cryptoSync.decryptChunkSync(cipherBufSync)

      const cipherBuf = await crypto.encryptBlock(plainBuf)
      const decryptedBuf = await crypto.decryptChunk(cipherBuf)

      expect(decryptedBufSync).toEqual(decryptedBuf)
      expect(decryptedBufSync).toEqual(plainBuf)
      done()
    })

    test('encryption and decryption are consistent async', async done => {
      let plainBuf = Buffer.from('very important secret')

      let cipherBuf = await crypto.encryptBlock(plainBuf)
      const deciphered = await crypto.decryptChunk(cipherBuf)

      expect(deciphered).toStrictEqual(plainBuf)
      expect(cipherBuf).not.toEqual(plainBuf)
      done()
    })

    test('encryption and decryption do not throw errors - async', async () => {
      let plainBuf = Buffer.from('very important secret')
      const cipherBuf = await crypto.encryptBlock(plainBuf)

      expect(crypto.encryptBlock(plainBuf)).resolves.not.toThrow()
      expect(crypto.decryptChunk(cipherBuf)).resolves.not.toThrow()
    })
  })

  describe('Webworker tests', () => {
    let key: Buffer
    let crypto: Crypto

    beforeEach(() => {
      // Create the cryptor
      key = Buffer.from('very password')
      crypto = new Crypto(key, nodeCryptoLib, true)
    })

    test('can use webworkers - async', async done => {
      const plainBuf = Buffer.from('some plaintext')

      const cipherBuf = await crypto.encryptBlock(plainBuf)

      const decryptedBuf = await crypto.decryptChunk(cipherBuf)

      expect(decryptedBuf).toEqual(plainBuf)
      expect(decryptedBuf).not.toEqual(cipherBuf)
      done()
    })

    test('webworkers are significantly faster than sync', async done => {
      const numTrials = 100
      const randomBlocks: Buffer[] = []
      for (let i=0; i < numTrials; i++) {
        const randomBlock = nodeCryptoLib.randomBytes(4096)
        randomBlocks.push(randomBlock)
      }
      const t0 = performance.now()
      await Promise.all(
        randomBlocks.map((buffer) => {
          return crypto.encryptBlock(buffer)
        })
      )
      const webworkersTime = performance.now() - t0

      const t1 = performance.now()
      // Test sync
      randomBlocks.forEach((buffer) => {
        crypto.encryptBlockSync(buffer)
      })
      const syncTime = performance.now() - t1



      // const cipherBuf = await crypto.encryptBlock(plainBuf)

      // const decryptedBuf = await crypto.decryptChunk(cipherBuf)

      // expect(decryptedBuf).toEqual(plainBuf)
      // expect(decryptedBuf).not.toEqual(cipherBuf)
      done()
    }, 10000)
  })
})
