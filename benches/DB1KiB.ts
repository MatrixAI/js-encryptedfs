import type { EFSWorkerModule } from '@/workers';

import os from 'os';
import path from 'path';
import fs from 'fs';
import b from 'benny';
import { spawn, Worker } from 'threads';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import { DB } from '@/db';
import * as utils from '@/utils';
import packageJson from '../package.json';

const logger = new Logger('DB1KiB Bench', LogLevel.WARN, [new StreamHandler()]);

async function main() {
  const cores = os.cpus().length;
  logger.warn(`Cores: ${cores}`);
  const workerManager = new WorkerManager<EFSWorkerModule>({ logger });
  await workerManager.start({
    workerFactory: () => spawn(new Worker('../src/workers/efsWorker')),
    cores,
  });
  const dataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'encryptedfs-benches-'),
  );
  const dbKey = await utils.generateKey(256);
  // Db1 doesn't use workers
  const dbPath1 = `${dataDir}/db1`;
  const db1 = await DB.createDB({ dbKey, dbPath: dbPath1, logger });
  await db1.start();
  // Db2 uses workers
  const dbPath2 = `${dataDir}/db2`;
  const db2 = await DB.createDB({ dbKey, dbPath: dbPath2, logger });
  await db2.start();
  db2.setWorkerManager(workerManager);
  const data0 = utils.getRandomBytesSync(0);
  const data1KiB = utils.getRandomBytesSync(1024);
  const summary = await b.suite(
    'DB1KiB',
    b.add('get 1 KiB of data', async () => {
      await db1.put([], '1kib', data1KiB, true);
      return async () => {
        await db1.get([], '1kib', true);
      };
    }),
    b.add('put 1 KiB of data', async () => {
      await db1.put([], '1kib', data1KiB, true);
    }),
    b.add('put zero data', async () => {
      await db1.put([], '0', data0, true);
    }),
    b.add('put zero data then del', async () => {
      await db1.put([], '0', data0, true);
      await db1.del([], '0');
    }),
    b.add('get 1 KiB of data with workers', async () => {
      await db2.put([], '1kib', data1KiB, true);
      return async () => {
        await db2.get([], '1kib', true);
      };
    }),
    b.add('put 1 KiB of data with workers', async () => {
      await db2.put([], '1kib', data1KiB, true);
    }),
    b.add('put zero data with workers', async () => {
      await db2.put([], '0', data0, true);
    }),
    b.add('put zero data then del with workers', async () => {
      await db2.put([], '0', data0, true);
      await db2.del([], '0');
    }),
    b.cycle(),
    b.complete(),
    b.save({
      file: 'DB1KiB',
      folder: 'benches/results',
      version: packageJson.version,
      details: true,
    }),
    b.save({
      file: 'DB1KiB',
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
  await workerManager.stop();
  return summary;
}

if (require.main === module) {
  main();
}

export default main;
