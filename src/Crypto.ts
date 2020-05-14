import { CryptoInterface, Cipher, Decipher, AlgorithmGCM } from './util'
import { spawn, Worker, ModuleThread } from 'threads'
import * as crypto from 'crypto'

export default class Crypto {
  private algorithm: AlgorithmGCM
  private initVector: Buffer
  private key: Buffer
  private useWebWorkers: boolean
  private cryptorWorker?: ModuleThread
  private cipher: Cipher
  private decipher: Decipher
  private cryptoLib: CryptoInterface
  constructor(
    key: Buffer | string,
    cryptoLib: CryptoInterface,
    initVector?: Buffer,
    algorithm: AlgorithmGCM = 'aes-256-gcm',
    useWebWorkers: boolean = false,
  ) {
    this.algorithm = algorithm
    this.cryptoLib = cryptoLib
    this.initVector = initVector ?? this.cryptoLib.randomBytes(16)
    // TODO: generate salt ?
    this.key = this.pbkdfSync(key)
    this.cipher = crypto.createCipheriv(algorithm, this.key, this.initVector)
    this.decipher = crypto.createDecipheriv(algorithm, this.key, this.initVector)
    // Async via Process or Web workers
    this.useWebWorkers = useWebWorkers
    if (this.useWebWorkers) {
      spawn(new Worker("./CryptoWorker")).then((worker) => {
        this.cryptorWorker = worker
        this.cryptorWorker.init(this.algorithm, this.key, this.initVector)
      })
    }
  }


  encryptSync(plainBuf: string | Buffer, initVector?: Buffer): Buffer {
    if (initVector && (initVector !== this.initVector)) {
      this.initVector = initVector
      this.cipher = this.cryptoLib.createCipheriv(this.algorithm, this.key, initVector)
    }
    return this.cipher.update(plainBuf)
  }

  async encrypt(plainBuf: string | Buffer, initVector?: Buffer): Promise<Buffer> {
    // Re-initialize cipher if initVector was provided
    if (initVector && (initVector !== this.initVector)) {
      this.initVector = initVector
      if (this.useWebWorkers && this.cryptorWorker) {
        return await this.cryptorWorker.init(this.algorithm, this.key, initVector)
      } else {
        this.cipher = this.cryptoLib.createCipheriv(this.algorithm, this.key, this.initVector)
      }
    }

    let buffer: Buffer
    if (this.useWebWorkers && this.cryptorWorker) {
      buffer = await this.cryptorWorker.encryptBuf(plainBuf)
    } else {
      buffer = this.cipher.update(plainBuf)
    }
    return buffer
  }

  decryptSync(cipherBuf: Buffer, initVector?: Buffer): Buffer {
    if (initVector && (initVector !== this.initVector)) {
      this.initVector = initVector
      this.decipher = this.cryptoLib.createDecipheriv(this.algorithm, this.key, initVector)
    }

    return this.decipher.update(cipherBuf)
  }

  async decrypt(cipherBuf: Buffer, initVector?: Buffer): Promise<Buffer> {
    if (initVector && (initVector !== this.initVector)) {
      this.initVector = initVector
      if (this.useWebWorkers && this.cryptorWorker) {
        return await this.cryptorWorker.init(this.algorithm, this.key, initVector)
      } else {
        this.decipher = this.cryptoLib.createDecipheriv(this.algorithm, this.key, this.initVector)
      }
    }

    let buffer: Buffer
    if (this.useWebWorkers && this.cryptorWorker) {
      buffer = await this.cryptorWorker.decryptBuf(cipherBuf)
    } else {
      buffer = this.decipher.update(cipherBuf)
    }
    return buffer
  }

  decryptCommitSync(): Buffer {
    return this.decipher.final()
  }

  async decryptCommit(): Promise<Buffer> {
    return this.decipher.final()
  }

  // ========= HELPER FUNCTIONS =============

  public getInitVector() : Buffer {
    return this.initVector
  }

  getRandomInitVectorSync(): Buffer {
    return crypto.randomBytes(this.initVector.length)
  }

  async getRandomInitVector(): Promise<Buffer> {
    return crypto.randomBytes(this.initVector.length)
  }

  private pbkdfSync(pass: string | Buffer, salt = '', algo = 'sha256', keyLen = 32, numIterations = 10000): Buffer {
    return crypto.pbkdf2Sync(pass, salt, numIterations, keyLen, algo)
  }

  private async pbkdf(pass: string | Buffer, salt = '', algo = 'sha256', keyLen = 32, numIterations = 10000, callback: (err: Error | null, key: Buffer) => void) {
    crypto.pbkdf2(pass, salt, numIterations, keyLen, algo, (err, key) => {
      callback(err, key)
    })
  }

  hashSync(data: string | Buffer, outputEncoding: 'hex' | 'latin1' | 'base64' = 'hex'): Buffer {
    const hash = crypto.createHash('sha256')
    hash.update(data)
    return hash.digest()
  }
}
