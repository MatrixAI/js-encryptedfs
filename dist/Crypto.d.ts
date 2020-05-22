/// <reference types="node" />
import { CryptoInterface, AlgorithmGCM } from "./util";
export default class Crypto {
  private masterKey;
  private algorithm;
  private useWebWorkers;
  private cryptoWorker?;
  private cipher;
  private decipher;
  private cryptoLib;
  constructor(
    masterKey: Buffer,
    cryptoLib: CryptoInterface,
    useWebWorkers?: boolean,
    algorithm?: AlgorithmGCM
  );
  resetSync(
    masterKey: Buffer,
    initVector: Buffer,
    salt: Buffer,
    authTag?: Buffer
  ): void;
  encryptBlockSync(blockBuffer: Buffer): Buffer;
  encryptBlock(blockBuffer: Buffer): Promise<Buffer>;
  decryptChunkSync(chunkBuffer: Buffer): Buffer;
  decryptChunk(chunkBuffer: Buffer): Promise<Buffer>;
  hashSync(
    data: string | Buffer,
    outputEncoding?: "hex" | "latin1" | "base64"
  ): Buffer;
  private delay;
  private waitForCryptoWorkerInit;
}
