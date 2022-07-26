import type { EFSWorkerModule } from '@/workers';
import os from 'os';
import path from 'path';
import b from 'benny';
import { spawn, Worker, Transfer } from 'threads';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import * as utils from '@/utils';
import { suiteCommon } from './utils';

const logger = new Logger('crypto10KiB Bench', LogLevel.WARN, [
  new StreamHandler(),
]);

async function main() {
  const cores = os.cpus().length;
  logger.warn(`Cores: ${cores}`);
  const workerManager =
    await WorkerManager.createWorkerManager<EFSWorkerModule>({
      workerFactory: () => spawn(new Worker('../src/workers/efsWorker')),
      cores: 1,
      logger,
    });
  const key = utils.generateKeySync(256);
  const plain10KiB = utils.getRandomBytesSync(1024 * 10);
  const cipher10KiB = await utils.encrypt(key, plain10KiB);
  const summary = await b.suite(
    path.basename(__filename, path.extname(__filename)),
    b.add('encrypt 10 KiB of data', async () => {
      await utils.encrypt(key, plain10KiB);
    }),
    b.add('decrypt 10 KiB of data', async () => {
      await utils.decrypt(key, cipher10KiB);
    }),
    b.add('encrypt 10 KiB of data with workers', async () => {
      const keyAB = utils.toArrayBuffer(key);
      const plainTextAB = utils.toArrayBuffer(plain10KiB);
      const cipherTextAB = await workerManager.call(async (w) => {
        return await w.encrypt(
          Transfer(keyAB),
          // @ts-ignore: threads.js types are wrong
          Transfer(plainTextAB),
        );
      });
      utils.fromArrayBuffer(cipherTextAB);
    }),
    b.add('decrypt 10 KiB of data with workers', async () => {
      const keyAB = utils.toArrayBuffer(key);
      const cipherTextAB = cipher10KiB.slice(0);
      const decrypted = await workerManager.call(async (w) => {
        return await w.decrypt(
          Transfer(keyAB),
          // @ts-ignore: threads.js types are wrong
          Transfer(cipherTextAB),
        );
      });
      if (decrypted != null) {
        utils.fromArrayBuffer(decrypted);
      }
    }),
    ...suiteCommon,
  );
  await workerManager.destroy();
  return summary;
}

if (require.main === module) {
  void main();
}

export default main;
