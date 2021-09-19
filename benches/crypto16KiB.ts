import type { EFSWorkerModule } from '@/workers';

import os from 'os';
import b from 'benny';
import { spawn, Worker, Transfer } from 'threads';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import * as utils from '@/utils';
import packageJson from '../package.json';

const logger = new Logger('crypto16KiB Bench', LogLevel.WARN, [
  new StreamHandler(),
]);

async function main() {
  const cores = os.cpus().length;
  logger.warn(`Cores: ${cores}`);
  const workerManager = await WorkerManager.createWorkerManager({
    workerFactory: () => spawn(new Worker('../src/workers/efsWorker')),
    cores: 1,
    logger,
  });
  const key = utils.generateKeySync(256);
  const plain16KiB = utils.getRandomBytesSync(1024 * 16);
  const cipher16KiB = await utils.encrypt(key, plain16KiB);
  const summary = await b.suite(
    'crypto16KiB',
    b.add('encrypt 16 KiB of data', async () => {
      await utils.encrypt(key, plain16KiB);
    }),
    b.add('decrypt 16 KiB of data', async () => {
      await utils.decrypt(key, cipher16KiB);
    }),
    b.add('encrypt 16 KiB of data with workers', async () => {
      await workerManager.call(async (w) => {
        const keyAB = utils.toArrayBuffer(key);
        const plainTextAB = utils.toArrayBuffer(plain16KiB);
        const cipherTextAB = await w.encrypt(
          Transfer(keyAB),
          // @ts-ignore: threads.js types are wrong
          Transfer(plainTextAB),
        );
        return utils.fromArrayBuffer(cipherTextAB);
      });
    }),
    b.add('decrypt 16 KiB of data with workers', async () => {
      await workerManager.call(async (w) => {
        const keyAB = utils.toArrayBuffer(key);
        const decrypted = await w.decrypt(
          Transfer(keyAB),
          // @ts-ignore: threads.js types are wrong
          Transfer(cipher16KiB),
        );
        return decrypted != null ? utils.fromArrayBuffer(decrypted) : decrypted;
      });
    }),
    b.cycle(),
    b.complete(),
    b.save({
      file: 'crypto16KiB',
      folder: 'benches/results',
      version: packageJson.version,
      details: true,
    }),
    b.save({
      file: 'crypto16KiB',
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
