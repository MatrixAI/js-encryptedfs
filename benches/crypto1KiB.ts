import type { EFSWorkerModule } from '@/workers';

import os from 'os';
import b from 'benny';
import { spawn, Transfer, Worker } from 'threads';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import * as utils from '@/utils';
import packageJson from '../package.json';

const logger = new Logger('crypto1KiB Bench', LogLevel.WARN, [
  new StreamHandler(),
]);

async function main() {
  const cores = os.cpus().length;
  logger.warn(`Cores: ${cores}`);
  const workerManager =
    await WorkerManager.createWorkerManager<EFSWorkerModule>({
      workerFactory: () => spawn(new Worker('../src/workers/efsWorker')),
      cores,
      logger,
    });
  const key = utils.generateKeySync(256);
  const plain1KiB = utils.getRandomBytesSync(1024);
  const cipher1KiB = await utils.encrypt(key, plain1KiB);
  const summary = await b.suite(
    'crypto1KiB',
    b.add('encrypt 1 KiB of data', async () => {
      await utils.encrypt(key, plain1KiB);
    }),
    b.add('decrypt 1 KiB of data', async () => {
      await utils.decrypt(key, cipher1KiB);
    }),
    b.add('encrypt 1 KiB of data with workers', async () => {
      const keyAB = utils.toArrayBuffer(key);
      const plainTextAB = utils.toArrayBuffer(plain1KiB);
      const cipherTextAB = await workerManager.call(async (w) => {
        return await w.encrypt(
          Transfer(keyAB),
          // @ts-ignore: threads.js types are wrong
          Transfer(plainTextAB),
        );
      });
      utils.fromArrayBuffer(cipherTextAB);
    }),
    b.add('decrypt 1 KiB of data with workers', async () => {
      const keyAB = utils.toArrayBuffer(key);
      const cipherTextAB = cipher1KiB.slice(0);
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
    b.cycle(),
    b.complete(),
    b.save({
      file: 'crypto1KiB',
      folder: 'benches/results',
      version: packageJson.version,
      details: true,
    }),
    b.save({
      file: 'crypto1KiB',
      folder: 'benches/results',
      format: 'chart.html',
    }),
  );
  await workerManager.destroy();
  return summary;
}

if (require.main === module) {
  main();
}

export default main;
