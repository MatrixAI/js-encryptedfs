export interface Cipher {
  update(data: string | Buffer): Buffer;
  final(): Buffer;
  setAAD(buffer: Buffer, options: { plaintextLength: number }): this;
  getAuthTag(): Buffer;
}

export interface Decipher {
  update(data: Buffer): Buffer;
  final(): Buffer;
  setAuthTag(buffer: Buffer): this;
  setAAD(buffer: Buffer, options?: { plaintextLength: number }): this;
}

export interface Hash {
  update(data: Buffer | string): void
  digest(): Buffer
}

export type AlgorithmGCM = 'aes-128-gcm' | 'aes-192-gcm' | 'aes-256-gcm'
export interface CryptoInterface {
  createDecipheriv(algorithm: AlgorithmGCM, key: Buffer, iv: Buffer | null): Decipher,
  createCipheriv(algorithm: AlgorithmGCM, key: Buffer, iv: Buffer | null, options?: any): Cipher,
  randomBytes(size: number): Buffer,
  pbkdf2Sync(password: Buffer, salt: Buffer, iterations: number, keylen: number, digest: string): Buffer,
  pbkdf2(password: Buffer, salt: Buffer, iterations: number, keylen: number, digest: string, callback: (err: Error | null, derivedKey: Buffer) => any): void
  createHash(algorithm: string): Hash
}

type DeconstructedChunkData = {
  salt: Buffer,
  initVector: Buffer,
  authTag: Buffer,
  encryptedBuffer: Buffer
}

export function deconstructChunk(chunkBuffer: Buffer): DeconstructedChunkData {
  const saltEnd = cryptoConstants.SALT_LEN
  const initVectorEnd = saltEnd + cryptoConstants.INIT_VECTOR_LEN
  const authTagEnd = initVectorEnd + cryptoConstants.AUTH_TAG_LEN

  const salt = chunkBuffer.slice(0, saltEnd)
  const initVector = chunkBuffer.slice(saltEnd, initVectorEnd)
  const authTag = chunkBuffer.slice(initVectorEnd, authTagEnd)
  const encryptedBuffer = chunkBuffer.slice(authTagEnd)

  return {
    salt,
    initVector,
    authTag,
    encryptedBuffer
  }
}

export const cryptoConstants = Object.freeze({
  SALT_LEN: 64,
  INIT_VECTOR_LEN: 12,
  AUTH_TAG_LEN: 16,
  KEY_LEN: 32,
  PBKDF_NUM_ITERATIONS: 9816
})
