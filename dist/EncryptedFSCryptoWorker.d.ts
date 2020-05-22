/// <reference types="node" />
declare const encryptedFSCryptoWorker: {
    encryptBlock(blockBuffer: Buffer, masterKey: Buffer, salt: Buffer, initVector: Buffer): Buffer;
    decryptChunk(chunkBuffer: Buffer, masterKey: Buffer): Buffer;
};
export declare type EncryptedFSCryptoWorker = typeof encryptedFSCryptoWorker;
export {};
