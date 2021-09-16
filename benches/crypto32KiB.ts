import type { EFSWorkerModule } from '@/workers';

import os from 'os';
import b from 'benny';
import { spawn, Worker, Transfer } from 'threads';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import * as utils from '@/utils';
import packageJson from '../package.json';

const logger = new Logger('crypto32KiB Bench', LogLevel.WARN, [
  new StreamHandler(),
]);

async function main() {
  const cores = os.cpus().length;
  logger.warn(`Cores: ${cores}`);
  const workerManager = new WorkerManager<EFSWorkerModule>({ logger });
  await workerManager.start({
    workerFactory: () => spawn(new Worker('../src/workers/efsWorker')),
    cores,
  });
  const key = utils.generateKeySync(256);
  const plain32KiB = utils.getRandomBytesSync(1024 * 32);
  const cipher32KiB = utils.encryptWithKey(key, plain32KiB);
  const summary = await b.suite(
    'crypto32KiB',
    b.add('encrypt 32 KiB of data', async () => {
      utils.encryptWithKey(key, plain32KiB);
    }),
    b.add('decrypt 32 KiB of data', async () => {
      utils.decryptWithKey(key, cipher32KiB);
    }),
    b.add('encrypt 32 KiB of data with workers', async () => {
      await workerManager.call(async (w) => {
        const keyAB = utils.toArrayBuffer(key);
        const plainTextAB = utils.toArrayBuffer(plain32KiB);
        const cipherTextAB = await w.efsEncryptWithKey(
          Transfer(keyAB),
          // @ts-ignore: threads.js types are wrong
          Transfer(plainTextAB),
        );
        return utils.fromArrayBuffer(cipherTextAB);
      });
    }),
    b.add('decrypt 32 KiB of data with workers', async () => {
      await workerManager.call(async (w) => {
        const keyAB = utils.toArrayBuffer(key);
        const cipherTextAB = utils.toArrayBuffer(cipher32KiB);
        const decrypted = await w.efsDecryptWithKey(
          Transfer(keyAB),
          // @ts-ignore: threads.js types are wrong
          Transfer(cipherTextAB),
        );
        return decrypted != null ? utils.fromArrayBuffer(decrypted) : decrypted;
      });
    }),
    b.cycle(),
    b.complete(),
    b.save({
      file: 'crypto32KiB',
      folder: 'benches/results',
      version: packageJson.version,
      details: true,
    }),
    b.save({
      file: 'crypto32KiB',
      folder: 'benches/results',
      format: 'chart.html',
    }),
  );
  await workerManager.stop();
  return summary;
}

if (require.main === module) {
  main();
}

export default main;
