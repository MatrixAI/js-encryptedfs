import type { EFSWorkerModule } from '@/workers';
import os from 'os';
import path from 'path';
import b from 'benny';
import { spawn, Worker, Transfer } from 'threads';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import * as utils from '@/utils';
import { suiteCommon } from './utils';

const logger = new Logger('crypto1MiB Bench', LogLevel.WARN, [
  new StreamHandler(),
]);

async function main() {
  const cores = os.cpus().length;
  logger.warn(`Cores: ${cores}`);
  const workerManager =
    await WorkerManager.createWorkerManager<EFSWorkerModule>({
      workerFactory: () => spawn(new Worker('../src/workers/efsWorker')),
      cores: 1,
    });
  const key = utils.generateKeySync(256);
  const plain1MiB = utils.getRandomBytesSync(1024 * 1024);
  const cipher1MiB = await utils.encrypt(key, plain1MiB);
  const summary = await b.suite(
    path.basename(__filename, path.extname(__filename)),
    b.add('encrypt 1 MiB of data', async () => {
      await utils.encrypt(key, plain1MiB);
    }),
    b.add('decrypt 1 MiB of data', async () => {
      await utils.decrypt(key, cipher1MiB);
    }),
    b.add('encrypt 1 MiB of data with workers', async () => {
      const keyAB = utils.toArrayBuffer(key);
      const plainTextAB = utils.toArrayBuffer(plain1MiB);
      const cipherTextAB = await workerManager.call(async (w) => {
        return await w.encrypt(
          Transfer(keyAB),
          // @ts-ignore: threads.js types are wrong
          Transfer(plainTextAB),
        );
      });
      utils.fromArrayBuffer(cipherTextAB);
    }),
    b.add('decrypt 1 MiB of data with workers', async () => {
      const keyAB = utils.toArrayBuffer(key);
      const cipherTextAB = cipher1MiB.slice(0);
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
