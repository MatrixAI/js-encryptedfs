import { expose } from "threads"
import * as crypto from 'crypto'

let _cipher: crypto.Cipher
let _decipher: crypto.Decipher

const _cryptorWorker = {
  init(algorithm: string, key: Buffer, initVector: Buffer): void {
		_cipher = crypto.createCipheriv(algorithm, key, initVector)
		_decipher = crypto.createDecipheriv(algorithm, key, initVector)
  },
  updateCipher(algorithm: string, key: ArrayBuffer, initVector: ArrayBuffer, plainBuf: crypto.BinaryLike): Buffer {
    return _cipher.update(plainBuf)
  },
  _resetCipher(algorithm: string, key: crypto.CipherKey, initVector: crypto.BinaryLike): void {
		_cipher = crypto.createCipheriv(algorithm, Buffer.from(key), Buffer.from(initVector))
  },
  updateDecipher(algorithm: string, key: ArrayBuffer | SharedArrayBuffer, initVector: ArrayBuffer | SharedArrayBuffer, plainBuf: NodeJS.ArrayBufferView): Buffer {
    return _decipher.update(plainBuf)
  },
  _resetDecipher(algorithm: string, key: crypto.CipherKey, initVector: crypto.BinaryLike): void {
		_decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), Buffer.from(initVector))
  },
}

export type CryptorWorker = typeof _cryptorWorker

expose(_cryptorWorker)