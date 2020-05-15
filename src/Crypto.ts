import { CryptoInterface, Cipher, Decipher, AlgorithmGCM, cryptoConstants, deconstructChunk } from './util'
import { spawn, Worker, ModuleThread } from 'threads'

export default class Crypto {
  private masterKey: Buffer
  private algorithm: AlgorithmGCM
  // Web workers
  private useWebWorkers: boolean
  private cryptoWorker?: ModuleThread
  // Sync members
  private cipher: Cipher
  private decipher: Decipher
  // Crypto lib
  private cryptoLib: CryptoInterface
  constructor(
    masterKey: Buffer,
    cryptoLib: CryptoInterface,
    useWebWorkers: boolean = false,
    algorithm: AlgorithmGCM = 'aes-256-gcm'
  ) {
    // TODO: check the strength of the master key!
    this.masterKey = masterKey
    this.algorithm = algorithm
    this.cryptoLib = cryptoLib
    // Async via Process or Web workers
    this.useWebWorkers = useWebWorkers
    if (this.useWebWorkers) {
      spawn(new Worker("./CryptoWorker")).then((worker) => {
        this.cryptoWorker = worker
      })
    }
  }

  ///////////
  // Reset //
  ///////////
  resetSync(masterKey: Buffer, initVector: Buffer, salt: Buffer, authTag?: Buffer) {
    // Generate key
    const key = this.cryptoLib.pbkdf2Sync(masterKey, salt, cryptoConstants.PBKDF_NUM_ITERATIONS, cryptoConstants.KEY_LEN, 'sha512')
    this.cipher = this.cryptoLib.createCipheriv(this.algorithm, key, initVector)
    this.decipher = this.cryptoLib.createDecipheriv(this.algorithm, key, initVector)
    if (authTag) {
      this.decipher.setAuthTag(authTag)
    }
  }

  ////////////
  // Cipher //
  ////////////
  encryptBlockSync(blockBuffer: Buffer): Buffer {
    // Random initialization vector
    const initVector = this.cryptoLib.randomBytes(cryptoConstants.INIT_VECTOR_LEN)

    // Random salt
    const salt = this.cryptoLib.randomBytes(cryptoConstants.SALT_LEN)

    // Reset cipher
    this.resetSync(this.masterKey, initVector, salt)

    const encrypted = Buffer.concat([this.cipher.update(blockBuffer), this.cipher.final()])

    // Extract the auth tag
    const authTag = this.cipher.getAuthTag()

    // Construct chunk
    return Buffer.concat([salt, initVector, authTag, encrypted])
  }

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
      // Reset cipher
      this.resetSync(this.masterKey, initVector, salt)

      // Encrypt blockBuffer
      const encrypted = Buffer.concat([this.cipher.update(blockBuffer), this.cipher.final()])

      // Extract the auth tag
      const authTag = this.cipher.getAuthTag()

      // Construct chunk
      return Buffer.concat([salt, initVector, authTag, encrypted])
    }
  }

  //////////////
  // Decipher //
  //////////////
  decryptChunkSync(chunkBuffer: Buffer): Buffer {
    // Deconstruct chunk into metadata and encrypted data
    const { salt, initVector, authTag, encryptedBuffer } = deconstructChunk(chunkBuffer)

    // Reset decipher
    this.resetSync(this.masterKey, initVector, salt, authTag)

    // Decrypt into blockBuffer
    const blockBuffer = Buffer.concat([this.decipher.update(encryptedBuffer), this.decipher.final()])

    return blockBuffer
  }

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

      // Reset decipher
      this.resetSync(this.masterKey, initVector, salt, authTag)

      // Decrypt into blockBuffer
      return Buffer.concat([this.decipher.update(encryptedBuffer), this.decipher.final()])
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
