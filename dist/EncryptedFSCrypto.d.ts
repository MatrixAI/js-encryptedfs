/// <reference types="node" />
import { ModuleThread, Pool } from 'threads';
import { EncryptedFSCryptoWorker } from './EncryptedFSCryptoWorker';
interface Cipher {
    update(data: string | Buffer): Buffer;
    final(): Buffer;
    setAAD(buffer: Buffer, options: {
        plaintextLength: number;
    }): this;
    getAuthTag(): Buffer;
}
interface Decipher {
    update(data: Buffer): Buffer;
    final(): Buffer;
    setAuthTag(buffer: Buffer): this;
    setAAD(buffer: Buffer, options?: {
        plaintextLength: number;
    }): this;
}
interface Hash {
    update(data: Buffer | string): void;
    digest(): Buffer;
}
declare type AlgorithmGCM = 'aes-256-gcm';
export interface CryptoInterface {
    createDecipheriv(algorithm: AlgorithmGCM, key: Buffer, iv: Buffer | null): Decipher;
    createCipheriv(algorithm: AlgorithmGCM, key: Buffer, iv: Buffer | null, options?: any): Cipher;
    randomBytes(size: number): Buffer;
    pbkdf2Sync(password: Buffer, salt: Buffer, iterations: number, keylen: number, digest: string): Buffer;
    pbkdf2(password: Buffer, salt: Buffer, iterations: number, keylen: number, digest: string, callback: (err: Error | null, derivedKey: Buffer) => any): void;
    createHash(algorithm: string): Hash;
}
declare type DeconstructedChunkData = {
    salt: Buffer;
    initVector: Buffer;
    authTag: Buffer;
    encryptedBuffer: Buffer;
};
declare function deconstructChunk(chunkBuffer: Buffer): DeconstructedChunkData;
declare class EncryptedFSCrypto {
    private masterKey;
    private algorithm;
    private useWebWorkers;
    private workerPool?;
    private cryptoLib;
    constructor(masterKey: Buffer, cryptoLib: CryptoInterface, useWebWorkers?: boolean, workerPool?: Pool<ModuleThread<EncryptedFSCryptoWorker>>);
    /**
     * Synchronously encrypts the provided block buffer.
     * According to AES-GCM, the cipher is initialized with a random initVector and derived key.
     * These are stored at the beginning of the chunk.
     * @param {Buffer} blockBuffer Block to be encrypted.
     * @returns {Buffer} Encrypted chunk.
     */
    encryptBlockSync(blockBuffer: Buffer): Buffer;
    /**
     * Asynchronously encrypts the provided block buffer.
     * According to AES-GCM, the cipher is initialized with a random initVector and derived key.
     * These are stored at the beginning of the chunk.
     * @param {Buffer} blockBuffer Block to be encrypted.
     * @returns {Promise<Buffer>} Promise that resolves to the encrypted chunk.
     */
    encryptBlock(blockBuffer: Buffer): Promise<Buffer>;
    /**
     * Synchronously decrypts the provided chunk buffer.
     * According to AES-GCM, the decipher is initialized with the initVector and derived key used to encrypt the block.
     * These are stored at the beginning of the chunk.
     * @param {Buffer} chunkBuffer Chunk to be decrypted.
     * @returns {Buffer} Decrypted block.
     */
    decryptChunkSync(chunkBuffer: Buffer): Buffer;
    /**
     * Asynchronously decrypts the provided chunk buffer.
     * According to AES-GCM, the decipher is initialized with the initVector and derived key used to encrypt the block.
     * These are stored at the beginning of the chunk.
     * @param {Buffer} chunkBuffer Chunk to be decrypted.
     * @returns {Promise<Buffer>} Promise that resolves to the decrypted block.
     */
    decryptChunk(chunkBuffer: Buffer): Promise<Buffer>;
    hashSync(data: string | Buffer, outputEncoding?: 'hex' | 'latin1' | 'base64'): Buffer;
}
export { EncryptedFSCrypto, deconstructChunk };
