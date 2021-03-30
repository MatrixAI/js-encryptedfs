import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import WorkerManager from '../../src/workers/WorkerManager';
import { getRandomBytesSync } from '@/util';
import * as cryptoUtils from '@/crypto';

describe('EFS worker functions', () => {
  const logger = new Logger('EFS Worker Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const key = getRandomBytesSync(32);

  test('chunks passed in via workers for encryption', async () => {
    const chunkBuffer = Buffer.from('random string', 'binary');
    const workerManager = new WorkerManager({ logger });
    await workerManager.start();
    expect(
      (
        await workerManager.call(async (w) => {
          return await w.encryptBlock(
            key.toString('binary'),
            chunkBuffer.toString('binary'),
          );
        })
      ).length,
    ).toBe(chunkBuffer.length + 32);
    await workerManager.stop();
  });

  test('chunks passed in via workers for encryption and decrytpion', async () => {
    const chunkBuffer = Buffer.from('random string', 'binary');
    const workerManager = new WorkerManager({ logger });
    await workerManager.start();
    const encryptedChunk = Buffer.from(
      await workerManager.call(async (w) => {
        return await w.encryptBlock(
          key.toString('binary'),
          chunkBuffer.toString('binary'),
        );
      }),
      'binary',
    );

    let finalBuffer = await workerManager.call(async (w) => {
      const chunk = await w.decryptChunk(
        key.toString('binary'),
        encryptedChunk.toString('binary'),
      );
      if (chunk) {
        return Buffer.from(chunk, 'binary');
      } else {
        return;
      }
    });
    if (finalBuffer) {
      finalBuffer = Buffer.from(finalBuffer);
    }
    expect(finalBuffer).toStrictEqual(chunkBuffer);
    await workerManager.stop();
  });

  test('chunks passed in for encryption and then decryption via workers', async () => {
    const chunkBuffer = Buffer.from('random string', 'binary');
    const workerManager = new WorkerManager({ logger });
    await workerManager.start();
    const encryptedChunk = cryptoUtils.encryptBlock(key, chunkBuffer);
    let finalBuffer = await workerManager.call(async (w) => {
      const chunk = await w.decryptChunk(
        key.toString('binary'),
        encryptedChunk.toString('binary'),
      );
      if (chunk) {
        return Buffer.from(chunk, 'binary');
      } else {
        return;
      }
    });
    if (finalBuffer) {
      finalBuffer = Buffer.from(finalBuffer);
    }
    expect(finalBuffer).toStrictEqual(chunkBuffer);
    await workerManager.stop();
  });
  test('chunks passed in fro encryption via workers and then decryption', async () => {
    const chunkBuffer = Buffer.from('random string', 'binary');
    const workerManager = new WorkerManager({ logger });
    await workerManager.start();
    const encryptedChunk = Buffer.from(
      await workerManager.call(async (w) => {
        return await w.encryptBlock(
          key.toString('binary'),
          chunkBuffer.toString('binary'),
        );
      }),
      'binary',
    );
    const finalBuffer = cryptoUtils.decryptChunk(key, encryptedChunk);
    expect(finalBuffer).toStrictEqual(chunkBuffer);
    await workerManager.stop();
  });
});
