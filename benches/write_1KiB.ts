import type { EFSWorkerModule } from '@/workers';
import os from 'os';
import path from 'path';
import fs from 'fs';
import pathNode from 'path';
import b from 'benny';
import { spawn, Worker } from 'threads';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { WorkerManager } from '@matrixai/workers';
import * as utils from '@/utils';
import EncryptedFS from '@/EncryptedFS';
import { suiteCommon } from './utils';

const logger = new Logger('write 1KiB Bench', LogLevel.WARN, [
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
  const plain1KiBBuffer = utils.getRandomBytesSync(1024);
  const plain1KiBString = plain1KiBBuffer.toString();

  const dbKey: Buffer = utils.generateKeySync(256);
  const dataDir = await fs.promises.mkdtemp(
    pathNode.join(os.tmpdir(), 'encryptedfs-test-'),
  );
  const efs = await EncryptedFS.createEncryptedFS({
    dbPath: dataDir,
    dbKey,
    umask: 0o022,
    logger,
  });
  let count = 0;
  const fd = await efs.open(`someFile`, 'w');
  const summary = await b.suite(
    path.basename(__filename, path.extname(__filename)),
    b.add('opening a file', async () => {
      await efs.open('someFile', 'r+');
    }),
    b.add('writeFile 1 KiB of string data with new files', async () => {
      count++;
      await efs.writeFile(`file-${count}`, plain1KiBString);
    }),
    b.add('write 1 KiB of string data with fd', async () => {
      await efs.write(fd, plain1KiBString);
    }),

    b.add('write 1 KiB of string data with options', async () => {
      await efs.writeFile(`test`, plain1KiBString, {
        encoding: 'utf8',
        mode: 0o666,
        flag: 'w',
      });
    }),
    b.add('write 1 KiB of string data same file', async () => {
      await efs.writeFile(`test`, plain1KiBString);
    }),
    b.add('write 1 KiB of buffer data with fd', async () => {
      await efs.writeFile(fd, plain1KiBBuffer);
    }),
    b.add('write 1 KiB of buffer data with options', async () => {
      await efs.writeFile(fd, plain1KiBBuffer, {
        encoding: 'utf8',
        mode: 0o666,
        flag: 'w',
      });
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
