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

export type AlgorithmGCM = 'aes-128-gcm' | 'aes-192-gcm' | 'aes-256-gcm'
export interface CryptoInterface {
  createDecipheriv(algorithm: AlgorithmGCM, key: Buffer, iv: Buffer | null): Decipher,
  createCipheriv(algorithm: AlgorithmGCM, key: Buffer, iv: Buffer | null, options?: any): Cipher,
  randomBytes(size: number): Buffer,
}
