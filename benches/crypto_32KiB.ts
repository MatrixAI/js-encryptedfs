import type { EFSWorker } from '#efsWorker.js';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { Worker } from 'node:worker_threads';
import b from 'benny';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import { suiteCommon } from './utils/index.js';
import * as utils from '#utils.js';
import efsWorker from '#efsWorker.js';

const logger = new Logger('crypto32KiB Bench', LogLevel.WARN, [
  new StreamHandler(),
]);
const filename = url.fileURLToPath(new URL(import.meta.url));
const workerPath = path.join(filename, '../../dist/efsWorker');

async function main() {
  const cores = os.cpus().length;
  logger.warn(`Cores: ${cores}`);
  const workerManager = await WorkerManager.createWorkerManager<EFSWorker>({
    workerFactory: () => new Worker(workerPath),
    manifest: efsWorker,
    cores: 1,
    logger,
  });
  const key = utils.generateKeySync(256);
  const plain32KiB = utils.getRandomBytesSync(1024 * 32);
  const cipher32KiB = await utils.encrypt(key, plain32KiB);
  const summary = await b.suite(
    path.basename(filename, path.extname(filename)),
    b.add('encrypt 32 KiB of data', async () => {
      await utils.encrypt(key, plain32KiB);
    }),
    b.add('decrypt 32 KiB of data', async () => {
      await utils.decrypt(key, cipher32KiB);
    }),
    b.add('encrypt 32 KiB of data with workers', async () => {
      const keyAB = utils.toArrayBuffer(key);
      const plainTextAB = utils.toArrayBuffer(plain32KiB);
      const { data: cipherTextAB } = await workerManager.methods.encrypt(
        { key: keyAB, plainText: plainTextAB },
        [keyAB, plainTextAB],
      );
      utils.fromArrayBuffer(cipherTextAB);
      utils.fromArrayBuffer(cipherTextAB);
    }),
    b.add('decrypt 32 KiB of data with workers', async () => {
      const keyAB = utils.toArrayBuffer(key);
      const cipherTextAB = cipher32KiB.slice(0);
      const { data: decrypted } = await workerManager.methods.decrypt(
        { key: keyAB, cipherText: cipherTextAB },
        [keyAB, cipherTextAB],
      );
      if (decrypted != null) {
        utils.fromArrayBuffer(decrypted);
      }
    }),
    ...suiteCommon,
  );
  await workerManager.destroy();
  return summary;
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) {
  void main();
}

export default main;
