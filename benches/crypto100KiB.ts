import type { EFSWorkerModule } from '@/workers';

import os from 'os';
import b from 'benny';
import { spawn, Worker, Transfer } from 'threads';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import * as utils from '@/utils';
import packageJson from '../package.json';

const logger = new Logger('crypto100KiB Bench', LogLevel.WARN, [
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
  const plain100KiB = utils.getRandomBytesSync(1024 * 100);
  const cipher100KiB = await utils.encrypt(key, plain100KiB);
  const summary = await b.suite(
    'crypto100KiB',
    b.add('encrypt 100 KiB of data', async () => {
      await utils.encrypt(key, plain100KiB);
    }),
    b.add('decrypt 100 KiB of data', async () => {
      await utils.decrypt(key, cipher100KiB);
    }),
    b.add('encrypt 100 KiB of data with workers', async () => {
      const keyAB = utils.toArrayBuffer(key);
      const plainTextAB = utils.toArrayBuffer(plain100KiB);
      const cipherTextAB = await workerManager.call(async (w) => {
        return await w.encrypt(
          Transfer(keyAB),
          // @ts-ignore: threads.js types are wrong
          Transfer(plainTextAB),
        );
      });
      utils.fromArrayBuffer(cipherTextAB);
    }),
    b.add('decrypt 100 KiB of data with workers', async () => {
      const keyAB = utils.toArrayBuffer(key);
      const cipherTextAB = cipher100KiB.slice(0);
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
      file: 'crypto100KiB',
      folder: 'benches/results',
      version: packageJson.version,
      details: true,
    }),
    b.save({
      file: 'crypto100KiB',
      folder: 'benches/results',
      format: 'chart.html',
    }),
  );
  await workerManager.destroy();
  return summary;
}

if (require.main === module) {
  (async () => {
    await main();
  })();
}

export default main;
