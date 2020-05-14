import { expose } from "threads/worker"
import { CryptoInterface, Cipher, Decipher } from "./util"

let cipher: Cipher
let decipher: Decipher

function init(algorithm: 'aes-128-gcm' | 'aes-192-gcm' | 'aes-256-gcm', key: Buffer, initVector: Buffer, cryptoLib: CryptoInterface): void {
  cipher = cryptoLib.createCipheriv(algorithm, key, initVector)
  decipher = cryptoLib.createDecipheriv(algorithm, key, initVector)
}

function encryptBuf(plainBuf: Buffer): Buffer {
  return Buffer.from(cipher.update(plainBuf))
}

function decryptBuf(encryptedBuf: Buffer): Buffer {
  return Buffer.from(decipher.update(encryptedBuf))
}

export {init, encryptBuf, decryptBuf}

expose({
  init,
  encryptBuf,
  decryptBuf
})
