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
  const read1KiBBuffer = Buffer.alloc(1024, 0);
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
  await efs.writeFile('test', plain1KiBBuffer);
  const fd = await efs.open(`test`, 'r+');
  const summary = await b.suite(
    path.basename(__filename, path.extname(__filename)),
    b.add('readFile 1 KiB of data', async () => {
      await efs.readFile(`test`);
    }),
    b.add('readFile 1 KiB of data with options', async () => {
      await efs.readFile(`test`, {
        encoding: 'utf8',
        flag: 'r',
      });
    }),
    b.add('readFile 1 KiB of data with fd', async () => {
      await efs.read(fd, read1KiBBuffer);
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
