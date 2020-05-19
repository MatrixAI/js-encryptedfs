import { expose } from "threads/worker"
import * as crypto from 'crypto'
import { deconstructChunk } from './EncryptedFSCrypto'
import { cryptoConstants } from "./util"

function encryptBlock(blockBuffer: Buffer, masterKey: Buffer, algorithm: 'aes-128-gcm' | 'aes-192-gcm' | 'aes-256-gcm', salt: Buffer, initVector: Buffer): Buffer {
  // Initialize cipher
  const key = crypto.pbkdf2Sync(masterKey, salt, cryptoConstants.PBKDF_NUM_ITERATIONS, cryptoConstants.KEY_LEN, 'sha512')
  const cipher = crypto.createCipheriv(algorithm, key, initVector)

  // Encrypt the blockBuffer
  const encrypted = Buffer.concat([cipher.update(blockBuffer), cipher.final()])

  // Extract the auth tag
  const tag = cipher.getAuthTag()

  // Construct chunk
  return Buffer.concat([salt, initVector, tag, encrypted])
}

function decryptChunk(chunkBuffer: Buffer, masterKey: Buffer, algorithm: 'aes-128-gcm' | 'aes-192-gcm' | 'aes-256-gcm'): Buffer {
  // Deconstruct chunk into metadata and encrypted data
  const { salt, initVector, authTag, encryptedBuffer } = deconstructChunk(chunkBuffer)

  // Initialize decipher
  const key = crypto.pbkdf2Sync(masterKey, salt, cryptoConstants.PBKDF_NUM_ITERATIONS, cryptoConstants.KEY_LEN, 'sha512')
  const decipher = crypto.createDecipheriv(algorithm, key, initVector)
  decipher.setAuthTag(authTag)

  // Decrypt into blockBuffer
  const blockBuffer = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()])

  return blockBuffer
}

expose({
  encryptBlock,
  decryptChunk
})
