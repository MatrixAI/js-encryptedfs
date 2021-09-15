import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { Transfer } from 'threads';
import WorkerManager from '@/workers/WorkerManager';
import * as utils from '@/utils';

describe('EFS worker', () => {
  const logger = new Logger('EFS Worker Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const workerManager = new WorkerManager({ logger });
  let key: Buffer;
  beforeAll(async () => {
    key = await utils.generateKey();
    await workerManager.start();
  });
  afterAll(async () => {
    await workerManager.stop();
  });
  test('encryption and decryption', async () => {
    const plainText = Buffer.from('hello world', 'utf-8');
    const cipherText = await workerManager.call(async (w) => {
      const [cipherBuf, cipherOffset, cipherLength] = await w.encryptWithKey(
        Transfer(key.buffer),
        key.byteOffset,
        key.byteLength,
        // @ts-ignore: No easy fix for now.
        Transfer(plainText.buffer),
        plainText.byteOffset,
        plainText.byteLength,
      );
      return Buffer.from(cipherBuf, cipherOffset, cipherLength);
    });
    // Sanity check with main thread decryption
    expect(plainText.equals(utils.decryptWithKey(key, cipherText)!)).toBe(true);
    const plainText_ = await workerManager.call(async (w) => {
      const decrypted = await w.decryptWithKey(
        Transfer(key.buffer),
        key.byteOffset,
        key.byteLength,
        // @ts-ignore: No easy fix for now.
        Transfer(cipherText.buffer),
        cipherText.byteOffset,
        cipherText.byteLength,
      );
      if (decrypted != null) {
        return Buffer.from(decrypted[0], decrypted[1], decrypted[2]);
      } else {
        return;
      }
    });
    expect(plainText_).toBeDefined();
    expect(plainText.equals(plainText_!)).toBe(true);
    expect(plainText_?.toString()).toBe('hello world');
  });
  test('encryption and decryption within 1 call', async () => {
    // Use random bytes this time
    const plainText = await utils.getRandomBytes(4096);
    const plainText_ = await workerManager.call(async (w) => {
      const [cipherBuf, cipherOffset, cipherLength] = await w.encryptWithKey(
        Transfer(key.buffer),
        key.byteOffset,
        key.byteLength,
        // @ts-ignore: No easy fix for now.
        Transfer(plainText.buffer),
        plainText.byteOffset,
        plainText.byteLength,
      );
      const cipherText = Buffer.from(cipherBuf, cipherOffset, cipherLength);
      const decrypted = await w.decryptWithKey(
        Transfer(key.buffer),
        key.byteOffset,
        key.byteLength,
        // @ts-ignore: No easy fix for now.
        Transfer(cipherText.buffer),
        cipherText.byteOffset,
        cipherText.byteLength,
      );
      if (decrypted != null) {
        return Buffer.from(decrypted[0], decrypted[1], decrypted[2]);
      } else {
        return;
      }
    });
    expect(plainText_).toBeDefined();
    expect(plainText.equals(plainText_!)).toBe(true);
  });
});
