"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("./util");
function deconstructChunk(chunkBuffer) {
    const saltEnd = util_1.cryptoConstants.SALT_LEN;
    const initVectorEnd = saltEnd + util_1.cryptoConstants.INIT_VECTOR_LEN;
    const authTagEnd = initVectorEnd + util_1.cryptoConstants.AUTH_TAG_LEN;
    const salt = chunkBuffer.slice(0, saltEnd);
    const initVector = chunkBuffer.slice(saltEnd, initVectorEnd);
    const authTag = chunkBuffer.slice(initVectorEnd, authTagEnd);
    const encryptedBuffer = chunkBuffer.slice(authTagEnd);
    return {
        salt,
        initVector,
        authTag,
        encryptedBuffer,
    };
}
exports.deconstructChunk = deconstructChunk;
class EncryptedFSCrypto {
    constructor(masterKey, cryptoLib, useWebWorkers = false, workerPool) {
        this.algorithm = 'aes-256-gcm';
        // TODO: check the strength of the master key!
        this.masterKey = masterKey;
        this.cryptoLib = cryptoLib;
        // Async via Process or Web workers
        this.useWebWorkers = useWebWorkers;
        if (this.useWebWorkers) {
            if (workerPool) {
                this.workerPool = workerPool;
            }
            else {
                this.workerPool = util_1.initializeWorkerPool();
            }
        }
    }
    /**
     * Synchronously encrypts the provided block buffer.
     * According to AES-GCM, the cipher is initialized with a random initVector and derived key.
     * These are stored at the beginning of the chunk.
     * @param {Buffer} blockBuffer Block to be encrypted.
     * @returns {Buffer} Encrypted chunk.
     */
    encryptBlockSync(blockBuffer) {
        // Random initialization vector
        const initVector = this.cryptoLib.randomBytes(util_1.cryptoConstants.INIT_VECTOR_LEN);
        // Random salt
        const salt = this.cryptoLib.randomBytes(util_1.cryptoConstants.SALT_LEN);
        // Create cipher
        const key = this.cryptoLib.pbkdf2Sync(this.masterKey, salt, util_1.cryptoConstants.PBKDF_NUM_ITERATIONS, util_1.cryptoConstants.KEY_LEN, 'sha512');
        const cipher = this.cryptoLib.createCipheriv(this.algorithm, key, initVector);
        // Encrypt block
        const encrypted = Buffer.concat([cipher.update(blockBuffer), cipher.final()]);
        // Extract the auth tag
        const authTag = cipher.getAuthTag();
        // Construct chunk
        return Buffer.concat([salt, initVector, authTag, encrypted]);
    }
    /**
     * Asynchronously encrypts the provided block buffer.
     * According to AES-GCM, the cipher is initialized with a random initVector and derived key.
     * These are stored at the beginning of the chunk.
     * @param {Buffer} blockBuffer Block to be encrypted.
     * @returns {Promise<Buffer>} Promise that resolves to the encrypted chunk.
     */
    async encryptBlock(blockBuffer) {
        // Random initialization vector
        const initVector = this.cryptoLib.randomBytes(util_1.cryptoConstants.INIT_VECTOR_LEN);
        // Random salt
        const salt = this.cryptoLib.randomBytes(util_1.cryptoConstants.SALT_LEN);
        if (this.useWebWorkers) {
            if (!this.workerPool) {
                console.log('waiting for web worker initialization');
                while (!this.workerPool) { }
            }
            // Construct chunk
            const workerResponse = await this.workerPool.queue(async (workerCrypto) => {
                return await workerCrypto.encryptBlock(blockBuffer, this.masterKey, salt, initVector);
            });
            return Buffer.from(workerResponse);
        }
        else {
            // Create cipher
            const key = this.cryptoLib.pbkdf2Sync(this.masterKey, salt, util_1.cryptoConstants.PBKDF_NUM_ITERATIONS, util_1.cryptoConstants.KEY_LEN, 'sha512');
            const cipher = this.cryptoLib.createCipheriv(this.algorithm, key, initVector);
            // Encrypt block
            const encrypted = Buffer.concat([cipher.update(blockBuffer), cipher.final()]);
            // Extract the auth tag
            const authTag = cipher.getAuthTag();
            // Construct chunk
            return Buffer.concat([salt, initVector, authTag, encrypted]);
        }
    }
    /**
     * Synchronously decrypts the provided chunk buffer.
     * According to AES-GCM, the decipher is initialized with the initVector and derived key used to encrypt the block.
     * These are stored at the beginning of the chunk.
     * @param {Buffer} chunkBuffer Chunk to be decrypted.
     * @returns {Buffer} Decrypted block.
     */
    decryptChunkSync(chunkBuffer) {
        // Deconstruct chunk into metadata and encrypted data
        const { salt, initVector, authTag, encryptedBuffer } = deconstructChunk(chunkBuffer);
        // Create decipher
        const key = this.cryptoLib.pbkdf2Sync(this.masterKey, salt, util_1.cryptoConstants.PBKDF_NUM_ITERATIONS, util_1.cryptoConstants.KEY_LEN, 'sha512');
        const decipher = this.cryptoLib.createDecipheriv(this.algorithm, key, initVector);
        if (authTag) {
            decipher.setAuthTag(authTag);
        }
        // Decrypt into blockBuffer
        const blockBuffer = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
        return blockBuffer;
    }
    /**
     * Asynchronously decrypts the provided chunk buffer.
     * According to AES-GCM, the decipher is initialized with the initVector and derived key used to encrypt the block.
     * These are stored at the beginning of the chunk.
     * @param {Buffer} chunkBuffer Chunk to be decrypted.
     * @returns {Promise<Buffer>} Promise that resolves to the decrypted block.
     */
    async decryptChunk(chunkBuffer) {
        if (this.useWebWorkers) {
            if (!this.workerPool) {
                console.log('waiting for web worker initialization');
                while (!this.workerPool) { }
            }
            // Decrypt into blockBuffer
            const workerResponse = await this.workerPool.queue(async (workerCrypto) => {
                return await workerCrypto.decryptChunk(chunkBuffer, this.masterKey);
            });
            return Buffer.from(workerResponse);
        }
        else {
            // Deconstruct chunk into metadata and encrypted data
            const { salt, initVector, authTag, encryptedBuffer } = deconstructChunk(chunkBuffer);
            // Create decipher
            const key = this.cryptoLib.pbkdf2Sync(this.masterKey, salt, util_1.cryptoConstants.PBKDF_NUM_ITERATIONS, util_1.cryptoConstants.KEY_LEN, 'sha512');
            const decipher = this.cryptoLib.createDecipheriv(this.algorithm, key, initVector);
            if (authTag) {
                decipher.setAuthTag(authTag);
            }
            // Decrypt into blockBuffer
            return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
        }
    }
    // ========= Convenience functions ============= //
    hashSync(data, outputEncoding = 'hex') {
        const hash = this.cryptoLib.createHash('sha256');
        hash.update(data);
        return hash.digest();
    }
}
exports.EncryptedFSCrypto = EncryptedFSCrypto;
//# sourceMappingURL=EncryptedFSCrypto.js.map