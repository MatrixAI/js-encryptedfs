import { cryptoConstants } from './util'
import { spawn, Worker, ModuleThread } from 'threads'

interface Cipher {
  update(data: string | Buffer): Buffer;
  final(): Buffer;
  setAAD(buffer: Buffer, options: { plaintextLength: number }): this;
  getAuthTag(): Buffer;
}

interface Decipher {
  update(data: Buffer): Buffer;
  final(): Buffer;
  setAuthTag(buffer: Buffer): this;
  setAAD(buffer: Buffer, options?: { plaintextLength: number }): this;
}

interface Hash {
  update(data: Buffer | string): void
  digest(): Buffer
}

type AlgorithmGCM = 'aes-256-gcm'
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

function deconstructChunk(chunkBuffer: Buffer): DeconstructedChunkData {
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

class EncryptedFSCrypto {
  // Below is a diagram showing the layout of the encrypted chunks
  // |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
  // ||      ||                       ||                   ||                       ||
  // || Salt || Initialization Vector || Authorisation Tag || Encrypted Data ... -> ||
  // ||      ||                       ||                   ||                       ||
  // |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
  private masterKey: Buffer
  private algorithm: AlgorithmGCM = 'aes-256-gcm'
  // Web workers
  private useWebWorkers: boolean
  private cryptoWorker?: ModuleThread
  // Crypto lib
  private cryptoLib: CryptoInterface
  constructor(
    masterKey: Buffer,
    cryptoLib: CryptoInterface,
    useWebWorkers: boolean = false
  ) {
    // TODO: check the strength of the master key!
    this.masterKey = masterKey
    this.cryptoLib = cryptoLib
    // Async via Process or Web workers
    this.useWebWorkers = useWebWorkers
    if (this.useWebWorkers) {
      spawn(new Worker("./EncryptedFSCryptoWorker.ts")).then((worker) => {
        this.cryptoWorker = worker
      })
    }
  }

	/**
	 * Synchronously encrypts the provided block buffer.
   * According to AES-GCM, the cipher is initialized with a random initVector and derived key.
   * These are stored at the beginning of the chunk.
	 * @param {Buffer} blockBuffer Block to be encrypted.
	 * @returns {Buffer} Encrypted chunk.
	 */
  encryptBlockSync(blockBuffer: Buffer): Buffer {
    // Random initialization vector
    const initVector = this.cryptoLib.randomBytes(cryptoConstants.INIT_VECTOR_LEN)

    // Random salt
    const salt = this.cryptoLib.randomBytes(cryptoConstants.SALT_LEN)

    // Create cipher
    const key = this.cryptoLib.pbkdf2Sync(this.masterKey, salt, cryptoConstants.PBKDF_NUM_ITERATIONS, cryptoConstants.KEY_LEN, 'sha512')
    const cipher = this.cryptoLib.createCipheriv(this.algorithm, key, initVector)

    // Encrypt block
    const encrypted = Buffer.concat([cipher.update(blockBuffer), cipher.final()])

    // Extract the auth tag
    const authTag = cipher.getAuthTag()

    // Construct chunk
    return Buffer.concat([salt, initVector, authTag, encrypted])
  }

	/**
	 * Asynchronously encrypts the provided block buffer.
   * According to AES-GCM, the cipher is initialized with a random initVector and derived key.
   * These are stored at the beginning of the chunk.
	 * @param {Buffer} blockBuffer Block to be encrypted.
	 * @returns {Promise<Buffer>} Promise that resolves to the encrypted chunk.
	 */
  async encryptBlock(blockBuffer: Buffer): Promise<Buffer> {
    // Random initialization vector
    const initVector = this.cryptoLib.randomBytes(cryptoConstants.INIT_VECTOR_LEN)

    // Random salt
    const salt = this.cryptoLib.randomBytes(cryptoConstants.SALT_LEN)

    if (this.useWebWorkers) {
      if (!(await this.waitForCryptoWorkerInit())) {
        throw(Error('CryptoWorker does not exist'))
      }
      // Construct chunk
      return Buffer.from(await this.cryptoWorker!.encryptBlock(blockBuffer, this.masterKey, this.algorithm, salt, initVector))
    } else {
      // Create cipher
      const key = this.cryptoLib.pbkdf2Sync(this.masterKey, salt, cryptoConstants.PBKDF_NUM_ITERATIONS, cryptoConstants.KEY_LEN, 'sha512')
      const cipher = this.cryptoLib.createCipheriv(this.algorithm, key, initVector)

      // Encrypt block
      const encrypted = Buffer.concat([cipher.update(blockBuffer), cipher.final()])

      // Extract the auth tag
      const authTag = cipher.getAuthTag()

      // Construct chunk
      return Buffer.concat([salt, initVector, authTag, encrypted])
    }
  }

	/**
	 * Synchronously decrypts the provided chunk buffer.
   * According to AES-GCM, the decipher is initialized with the initVector and derived key used to encrypt the block.
   * These are stored at the beginning of the chunk.
	 * @param {Buffer} chunkBuffer Chunk to be decrypted.
	 * @returns {Buffer} Decrypted block.
	 */
  decryptChunkSync(chunkBuffer: Buffer): Buffer {
    // Deconstruct chunk into metadata and encrypted data
    const { salt, initVector, authTag, encryptedBuffer } = deconstructChunk(chunkBuffer)

    // Create decipher
    const key = this.cryptoLib.pbkdf2Sync(this.masterKey, salt, cryptoConstants.PBKDF_NUM_ITERATIONS, cryptoConstants.KEY_LEN, 'sha512')
    const decipher = this.cryptoLib.createDecipheriv(this.algorithm, key, initVector)
    if (authTag) {
      decipher.setAuthTag(authTag)
    }

    // Decrypt into blockBuffer
    const blockBuffer = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()])

    return blockBuffer
  }

	/**
	 * Asynchronously decrypts the provided chunk buffer.
   * According to AES-GCM, the decipher is initialized with the initVector and derived key used to encrypt the block.
   * These are stored at the beginning of the chunk.
	 * @param {Buffer} chunkBuffer Chunk to be decrypted.
	 * @returns {Promise<Buffer>} Promise that resolves to the decrypted block.
	 */
  async decryptChunk(chunkBuffer: Buffer): Promise<Buffer> {
    if (this.useWebWorkers) {
      if (!(await this.waitForCryptoWorkerInit())) {
        throw(Error('CryptoWorker does not exist'))
      }
      // Decrypt into blockBuffer
      return Buffer.from(await this.cryptoWorker!.decryptChunk(chunkBuffer, this.masterKey, this.algorithm))
    } else {
      // Deconstruct chunk into metadata and encrypted data
      const { salt, initVector, authTag, encryptedBuffer } = deconstructChunk(chunkBuffer)

      // Create decipher
      const key = this.cryptoLib.pbkdf2Sync(this.masterKey, salt, cryptoConstants.PBKDF_NUM_ITERATIONS, cryptoConstants.KEY_LEN, 'sha512')
      const decipher = this.cryptoLib.createDecipheriv(this.algorithm, key, initVector)
      if (authTag) {
        decipher.setAuthTag(authTag)
      }

      // Decrypt into blockBuffer
      return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()])
    }
  }

  // ========= Convenience functions ============= //
  hashSync(data: string | Buffer, outputEncoding: 'hex' | 'latin1' | 'base64' = 'hex'): Buffer {
    const hash = this.cryptoLib.createHash('sha256')
    hash.update(data)
    return hash.digest()
  }

  private async delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) )
  }

  private async waitForCryptoWorkerInit(): Promise<boolean> {
    for (let trial=0; trial < 10; trial++) {
      if (this.cryptoWorker) {
        return true
      } else {
        await this.delay(100)
      }
    }
    return false
  }
}


export { EncryptedFSCrypto, deconstructChunk }
