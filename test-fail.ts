import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import { EncryptedFS, utils } from './src';

async function main () {
  const logger = new Logger('EncryptedFS Files', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const dataDir = await fs.promises.mkdtemp(
    pathNode.join(os.tmpdir(), 'encryptedfs-test-'),
  );
  const dbPath = `${dataDir}/db`;
  const dbKey: Buffer = utils.generateKeySync(256);
  const efs = await EncryptedFS.createEncryptedFS({
    dbKey,
    dbPath,
    umask: 0o022,
    logger,
  });

  await efs.writeFile('/fdtest', 'abcdef');

  // File is abcdef
  console.log('BEFORE OPEN:', await efs.readFile('/fdtest', { encoding: 'utf-8'}));

  const fd = await efs.open('/fdtest', 'r+');

  // File is abcdef
  console.log('BEFORE TRUNCATE:', await efs.readFile('/fdtest', { encoding: 'utf-8'}));

  await efs.ftruncate(fd, 4);
  await efs.close(fd);

  // File should be abcd, but is instead abcdef
  console.log('FINAL:', await efs.readFile('/fdtest', { encoding: 'utf-8'}));

  // to figure out what the difference is
  // we can walk backwards to find out
  // at the fileWriteBlock

}

main();
