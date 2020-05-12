import * as crypto from 'crypto'
import { spawn, Worker, ModuleThread } from 'threads'
import { Buffer } from 'buffer/'

export default class Crypto {
  private algorithm: string
  private initVector: Buffer
  private key: Buffer
  private cipher: crypto.Cipher
  private decipher: crypto.Decipher
  private useWebWorkers: boolean
  private cryptorWorker?: ModuleThread
  constructor(
    key: Buffer | string,
    initVector: Buffer = Buffer.from(crypto.randomBytes(16)),
    algorithm: string = 'aes-256-gcm',
    useWebWorkers: boolean = false
  ) {
    this.algorithm = algorithm
    this.initVector = initVector
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
      this.resetCipherSync(initVector!)
    }
    return Buffer.from(this.cipher.update(plainBuf))
  }

  async encrypt(plainBuf: string | Buffer, initVector: Buffer | undefined = undefined): Promise<Buffer> {
    if (initVector && (initVector !== this.initVector)) {
      this.resetCipher(initVector!)
    }

    let buffer: Buffer
    if (this.useWebWorkers && this.cryptorWorker) {
      buffer = await this.cryptorWorker.encryptBuf(plainBuf)
    } else {
      buffer = Buffer.from(this.cipher.update(plainBuf))
    }
    return buffer
  }

  decryptSync(cipherBuf: Buffer, initVector?: Buffer): Buffer {
    if (initVector && (initVector !== this.initVector)) {
      this.resetDecipherSync(initVector!)
    }

    return Buffer.from(this.decipher.update(cipherBuf))
  }

  async decrypt(cipherBuf: Buffer, initVector: Buffer | undefined = undefined): Promise<Buffer> {
    if (initVector && (initVector !== this.initVector)) {
      await this.resetDecipher(initVector!)
    }

    let buffer: Buffer
    if (this.useWebWorkers && this.cryptorWorker) {
      buffer = await this.cryptorWorker.decryptBuf(cipherBuf)
    } else {
      buffer = Buffer.from(this.decipher.update(cipherBuf))
    }
    return buffer
  }

  decryptCommitSync(): Buffer {
    return Buffer.from(this.decipher.final())
  }

  async decryptCommit(): Promise<Buffer> {
    return Buffer.from(this.decipher.final())
  }

  // ========= HELPER FUNCTIONS =============

  public getInitVector() : Buffer {
    return this.initVector
  }

  private resetCipherSync(initVector: Buffer) {
    this.initVector = initVector
    this.cipher = crypto.createCipheriv(this.algorithm, this.key, initVector)

    return
  }

  private async resetCipher(initVector: Buffer) {
    this.initVector = initVector
    if (this.useWebWorkers && this.cryptorWorker) {
      return await this.cryptorWorker.init(this.algorithm, this.key, initVector)
    } else {
      this.cipher = crypto.createCipheriv(this.algorithm, this.key, this.initVector)
    }
    return
  }

  private resetDecipherSync(initVector: Buffer) {
    this.initVector = initVector
    this.decipher = crypto.createDecipheriv(this.algorithm, this.key, initVector)

    return
  }

  private async resetDecipher(initVector: Buffer) {
    this.initVector = initVector
    if (this.useWebWorkers && this.cryptorWorker) {
      return await this.cryptorWorker.init(this.algorithm, this.key, initVector)
    } else {
      this.decipher = crypto.createDecipheriv(this.algorithm, this.key, this.initVector)
    }
    return
  }

  getRandomInitVectorSync(): Buffer {
    return Buffer.from(crypto.randomBytes(this.initVector.length))
  }

  async getRandomInitVector(): Promise<Buffer> {
    return Buffer.from(crypto.randomBytes(this.initVector.length))
  }

  private pbkdfSync(pass: string | Buffer, salt = '', algo = 'sha256', keyLen = 32, numIterations = 10000): Buffer {
    return Buffer.from(crypto.pbkdf2Sync(pass, salt, numIterations, keyLen, algo))
  }

  private async pbkdf(pass: string | Buffer, salt = '', algo = 'sha256', keyLen = 32, numIterations = 10000, callback: (err: Error | null, key: Buffer) => void) {
    crypto.pbkdf2(pass, salt, numIterations, keyLen, algo, (err, key) => {
      callback(err, Buffer.from(key))
    })
  }

  hashSync(data: string | Buffer, outputEncoding: 'hex' | 'latin1' | 'base64' = 'hex'): Buffer {
    const hash = crypto.createHash('sha256')
    hash.update(data)
    return Buffer.from(hash.digest())
  }
}
