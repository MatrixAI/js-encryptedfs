import { expose } from "threads/worker"
import * as crypto from 'crypto'
import { Buffer } from 'buffer/'

let cipher: crypto.Cipher
let decipher: crypto.Decipher

function init(algorithm: string, key: Buffer, initVector: Buffer): void {
  cipher = crypto.createCipheriv(algorithm, key, initVector)
  decipher = crypto.createDecipheriv(algorithm, key, initVector)
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
