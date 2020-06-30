/// <reference types="node" />
import { Pool, ModuleThread } from 'threads';
import { EncryptedFSCryptoWorker } from './EncryptedFSCryptoWorker';
declare const cryptoConstants: Readonly<{
    SALT_LEN: number;
    INIT_VECTOR_LEN: number;
    AUTH_TAG_LEN: number;
    KEY_LEN: number;
    PBKDF_NUM_ITERATIONS: number;
}>;
declare function initializeWorkerPool(numWorkers?: number): Pool<ModuleThread<EncryptedFSCryptoWorker>>;
declare type UpperDirectoryMetadata = {
    size: number;
    keyHash: Buffer;
};
export { cryptoConstants, initializeWorkerPool, UpperDirectoryMetadata };
