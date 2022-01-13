import type { EFSWorkerModule } from '@/workers';

import os from 'os';
import path from 'path';
import fs from 'fs';
import b from 'benny';
import { spawn, Worker } from 'threads';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import { DB } from '@matrixai/db';
import * as utils from '@/utils';
import packageJson from '../package.json';

const logger = new Logger('Encrypted DB1MiB Bench', LogLevel.WARN, [
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
  const dataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'encryptedfs-benches-'),
  );
  const dbKey = await utils.generateKey(256);
  // Db1 doesn't use workers
  const dbPath1 = `${dataDir}/db1`;
  const db1 = await DB.createDB({
    crypto: {
      key: dbKey,
      ops: {
        encrypt: utils.encrypt,
        decrypt: utils.decrypt,
      },
    },
    dbPath: dbPath1,
    logger,
  });
  // Db2 uses workers
  const dbPath2 = `${dataDir}/db2`;
  const db2 = await DB.createDB({
    crypto: {
      key: dbKey,
      ops: {
        encrypt: utils.encrypt,
        decrypt: utils.decrypt,
      },
    },
    dbPath: dbPath2,
    logger,
  });
  db2.setWorkerManager(workerManager);
  const data1MiB = utils.getRandomBytesSync(1024 * 1024);
  const summary = await b.suite(
    'Encrypted DB1MiB',
    b.add('get 1 MiB of data', async () => {
      await db1.put([], '1mib', data1MiB, true);
      return async () => {
        await db1.get([], '1mib', true);
      };
    }),
    b.add('put 1 MiB of data', async () => {
      await db1.put([], '1mib', data1MiB, true);
    }),
    b.add('get 1 MiB of data with workers', async () => {
      await db2.put([], '1mib', data1MiB, true);
      return async () => {
        await db2.get([], '1mib', true);
      };
    }),
    b.add('put 1 MiB of data with workers', async () => {
      await db2.put([], '1mib', data1MiB, true);
    }),
    b.cycle(),
    b.complete(),
    b.save({
      file: 'Encrypted DB1MiB',
      folder: 'benches/results',
      version: packageJson.version,
      details: true,
    }),
    b.save({
      file: 'Encrypted DB1MiB',
      folder: 'benches/results',
      format: 'chart.html',
    }),
  );
  await db1.stop();
  await db2.stop();
  await fs.promises.rm(dataDir, {
    force: true,
    recursive: true,
  });
  await workerManager.destroy();
  return summary;
}

if (require.main === module) {
  (async () => {
    await main();
  })();
}

export default main;
