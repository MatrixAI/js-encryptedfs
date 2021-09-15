import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import { spawn, Worker, Transfer } from 'threads';
import { EFSWorkerModule } from '@/workers';
import * as utils from '@/utils';

describe('EFS worker', () => {
  const logger = new Logger('EFS Worker Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const workerManager = new WorkerManager<EFSWorkerModule>({ logger });
  let key: Buffer;
  beforeAll(async () => {
    key = await utils.generateKey();
    await workerManager.start({
      workerFactory: () => spawn(new Worker('../../src/workers/efsWorker')),
      cores: 1,
    });
  });
  afterAll(async () => {
    await workerManager.stop();
  });
  test('encryption and decryption', async () => {
    const plainText = Buffer.from('hello world', 'utf-8');
    const cipherText = await workerManager.call(async (w) => {
      const keyAB = utils.toArrayBuffer(key);
      const plainTextAB = utils.toArrayBuffer(plainText);
      const cipherTextAB = await w.efsEncryptWithKey(
        Transfer(keyAB),
        // @ts-ignore: threads.js types are wrong
        Transfer(plainTextAB),
      );
      expect(keyAB.byteLength).toBe(0);
      expect(plainTextAB.byteLength).toBe(0);
      return utils.fromArrayBuffer(cipherTextAB);
    });
    // Sanity check with main thread decryption
    expect(plainText.equals(utils.decryptWithKey(key, cipherText)!)).toBe(true);
    const plainText_ = await workerManager.call(async (w) => {
      const keyAB = utils.toArrayBuffer(key);
      const cipherTextAB = utils.toArrayBuffer(cipherText);
      const decrypted = await w.efsDecryptWithKey(
        Transfer(keyAB),
        // @ts-ignore: threads.js types are wrong
        Transfer(cipherTextAB),
      );
      expect(keyAB.byteLength).toBe(0);
      expect(cipherTextAB.byteLength).toBe(0);
      return decrypted != null ? utils.fromArrayBuffer(decrypted) : decrypted;
    });
    expect(plainText_).toBeDefined();
    expect(plainText.equals(plainText_!)).toBe(true);
    expect(plainText_?.toString()).toBe('hello world');
  });
  test('encryption and decryption within 1 call', async () => {
    // Use random bytes this time
    const plainText = await utils.getRandomBytes(4096);
    const plainText_ = await workerManager.call(async (w) => {
      let keyAB = utils.toArrayBuffer(key);
      const plainTextAB = utils.toArrayBuffer(plainText);
      const cipherTextAB = await w.efsEncryptWithKey(
        Transfer(keyAB),
        // @ts-ignore: threads.js types are wrong
        Transfer(plainTextAB),
      );
      expect(keyAB.byteLength).toBe(0);
      expect(plainTextAB.byteLength).toBe(0);
      // Previous keyAB has been detached
      keyAB = utils.toArrayBuffer(key);
      const decrypted = await w.efsDecryptWithKey(
        Transfer(keyAB),
        // @ts-ignore: threads.js types are wrong
        Transfer(cipherTextAB),
      );
      expect(keyAB.byteLength).toBe(0);
      expect(cipherTextAB.byteLength).toBe(0);
      return decrypted != null ? utils.fromArrayBuffer(decrypted) : decrypted;
    });
    expect(plainText_).toBeDefined();
    expect(plainText.equals(plainText_!)).toBe(true);
  });
});
