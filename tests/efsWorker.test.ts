import type { EFSWorker } from '#efsWorker.js';
import { Worker } from 'node:worker_threads';
import url from 'node:url';
import path from 'node:path';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import * as utils from '#utils.js';
import efsWorker from '#efsWorker.js';

const dirname = url.fileURLToPath(new URL('.', import.meta.url));
const workerPath = path.join(dirname, '../dist/efsWorker');

describe('EFS worker', () => {
  const logger = new Logger('EFS Worker Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let workerManager: WorkerManager<EFSWorker>;
  let key: Buffer;
  beforeAll(async () => {
    key = await utils.generateKey();
    workerManager = await WorkerManager.createWorkerManager<EFSWorker>({
      workerFactory: () => new Worker(workerPath),
      manifest: efsWorker,
      cores: 1,
      logger,
    });
  });
  afterAll(async () => {
    await workerManager.destroy();
  });
  test('encryption and decryption', async () => {
    await new Promise((res) => setTimeout(res, 1000));
    const plainText = Buffer.from('hello world', 'utf-8');
    const cipherTextAB = await (async () => {
      const keyAB = utils.toArrayBuffer(key);
      const plainTextAB = utils.toArrayBuffer(plainText);
      const { data: cipherTextAB } = await workerManager.methods.encrypt(
        { key: keyAB, plainText: plainTextAB },
        [keyAB, plainTextAB],
      );
      expect(keyAB.byteLength).toBe(0);
      expect(plainTextAB.byteLength).toBe(0);
      // Sanity check with main thread decryption
      expect(plainText).toEqual(
        Buffer.from((await utils.decrypt(key, cipherTextAB))!),
      );
      return cipherTextAB;
    })();

    const plainText_ = await (async () => {
      const keyAB = utils.toArrayBuffer(key);

      const { data: decrypted } = await workerManager.methods.decrypt(
        { key: keyAB, cipherText: cipherTextAB },
        [keyAB, cipherTextAB],
      );
      expect(keyAB.byteLength).toBe(0);
      expect(cipherTextAB.byteLength).toBe(0);
      // Sanity check with main thread decryption
      return decrypted != null ? utils.fromArrayBuffer(decrypted) : decrypted;
    })();
    expect(plainText_).toBeDefined();
    expect(plainText.equals(plainText_!)).toBe(true);
    expect(plainText_?.toString()).toBe('hello world');
  });
});
