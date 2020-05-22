"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("./util");
const threads_1 = require("threads");
class Crypto {
  constructor(
    masterKey,
    cryptoLib,
    useWebWorkers = false,
    algorithm = "aes-256-gcm"
  ) {
    // TODO: check the strength of the master key!
    this.masterKey = masterKey;
    this.algorithm = algorithm;
    this.cryptoLib = cryptoLib;
    // Async via Process or Web workers
    this.useWebWorkers = useWebWorkers;
    if (this.useWebWorkers) {
      threads_1.spawn(new threads_1.Worker("./CryptoWorker")).then((worker) => {
        this.cryptoWorker = worker;
      });
    }
  }
  ///////////
  // Reset //
  ///////////
  resetSync(masterKey, initVector, salt, authTag) {
    // Generate key
    const key = this.cryptoLib.pbkdf2Sync(
      masterKey,
      salt,
      util_1.cryptoConstants.PBKDF_NUM_ITERATIONS,
      util_1.cryptoConstants.KEY_LEN,
      "sha512"
    );
    this.cipher = this.cryptoLib.createCipheriv(
      this.algorithm,
      key,
      initVector
    );
    this.decipher = this.cryptoLib.createDecipheriv(
      this.algorithm,
      key,
      initVector
    );
    if (authTag) {
      this.decipher.setAuthTag(authTag);
    }
  }
  ////////////
  // Cipher //
  ////////////
  encryptBlockSync(blockBuffer) {
    // Random initialization vector
    const initVector = this.cryptoLib.randomBytes(
      util_1.cryptoConstants.INIT_VECTOR_LEN
    );
    // Random salt
    const salt = this.cryptoLib.randomBytes(util_1.cryptoConstants.SALT_LEN);
    // Reset cipher
    this.resetSync(this.masterKey, initVector, salt);
    const encrypted = Buffer.concat([
      this.cipher.update(blockBuffer),
      this.cipher.final(),
    ]);
    // Extract the auth tag
    const authTag = this.cipher.getAuthTag();
    // Construct chunk
    return Buffer.concat([salt, initVector, authTag, encrypted]);
  }
  async encryptBlock(blockBuffer) {
    // Random initialization vector
    const initVector = this.cryptoLib.randomBytes(
      util_1.cryptoConstants.INIT_VECTOR_LEN
    );
    // Random salt
    const salt = this.cryptoLib.randomBytes(util_1.cryptoConstants.SALT_LEN);
    if (this.useWebWorkers) {
      if (!(await this.waitForCryptoWorkerInit())) {
        throw Error("CryptoWorker does not exist");
      }
      // Construct chunk
      return Buffer.from(
        await this.cryptoWorker.encryptBlock(
          blockBuffer,
          this.masterKey,
          this.algorithm,
          salt,
          initVector
        )
      );
    } else {
      // Reset cipher
      this.resetSync(this.masterKey, initVector, salt);
      // Encrypt blockBuffer
      const encrypted = Buffer.concat([
        this.cipher.update(blockBuffer),
        this.cipher.final(),
      ]);
      // Extract the auth tag
      const authTag = this.cipher.getAuthTag();
      // Construct chunk
      return Buffer.concat([salt, initVector, authTag, encrypted]);
    }
  }
  //////////////
  // Decipher //
  //////////////
  decryptChunkSync(chunkBuffer) {
    // Deconstruct chunk into metadata and encrypted data
    const {
      salt,
      initVector,
      authTag,
      encryptedBuffer,
    } = util_1.deconstructChunk(chunkBuffer);
    // Reset decipher
    this.resetSync(this.masterKey, initVector, salt, authTag);
    // Decrypt into blockBuffer
    const blockBuffer = Buffer.concat([
      this.decipher.update(encryptedBuffer),
      this.decipher.final(),
    ]);
    return blockBuffer;
  }
  async decryptChunk(chunkBuffer) {
    if (this.useWebWorkers) {
      if (!(await this.waitForCryptoWorkerInit())) {
        throw Error("CryptoWorker does not exist");
      }
      // Decrypt into blockBuffer
      return Buffer.from(
        await this.cryptoWorker.decryptChunk(
          chunkBuffer,
          this.masterKey,
          this.algorithm
        )
      );
    } else {
      // Deconstruct chunk into metadata and encrypted data
      const {
        salt,
        initVector,
        authTag,
        encryptedBuffer,
      } = util_1.deconstructChunk(chunkBuffer);
      // Reset decipher
      this.resetSync(this.masterKey, initVector, salt, authTag);
      // Decrypt into blockBuffer
      return Buffer.concat([
        this.decipher.update(encryptedBuffer),
        this.decipher.final(),
      ]);
    }
  }
  // ========= Convenience functions ============= //
  hashSync(data, outputEncoding = "hex") {
    const hash = this.cryptoLib.createHash("sha256");
    hash.update(data);
    return hash.digest();
  }
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async waitForCryptoWorkerInit() {
    for (let trial = 0; trial < 10; trial++) {
      if (this.cryptoWorker) {
        return true;
      } else {
        await this.delay(100);
      }
    }
    return false;
  }
}
exports.default = Crypto;
//# sourceMappingURL=Crypto.js.map
