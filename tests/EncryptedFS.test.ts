import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import process from 'process';
import * as vfs from 'virtualfs';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import * as utils from '@/utils';
import EncryptedFS from '@/EncryptedFS';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';

describe('EncryptedFS', () => {
  const logger = new Logger('EncryptedFS Test', LogLevel.WARN, [new StreamHandler()]);
  // const cwd = process.cwd();
  let dataDir: string;
  let dbPath: string;
  let db: DB;
  let dbKey: Buffer = utils.generateKeySync(256);
  let iNodeMgr: INodeManager;
  const devMgr = new vfs.DeviceManager();
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      pathNode.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    dbPath = `${dataDir}/db`;
    db = await DB.createDB({
      dbKey,
      dbPath,
      logger
    });
    await db.start();
    iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger
    });
  });
  afterEach(async () => {
    await db.stop();
    await db.destroy();
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test('creation of EFS', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    expect(efs).toBeInstanceOf(EncryptedFS);
  });
  // test('translating paths at current directory', async () => {
  //   const efs = new EncryptedFS(key);
  //   expect(efs.getCwd()).toBe('/');
  //   expect(efs.cwdLower).toBe(cwd);
  //   // empty string is empty string
  //   expect(efs.translatePath('')).toEqual(['', '']);
  //   // upper root translates to the cwdLower
  //   expect(efs.translatePath('/')).toEqual([cwd, cwd]);
  //   expect(efs.translatePath('////')).toEqual([cwd, cwd]);
  //   expect(efs.translatePath('/../')).toEqual([cwd, cwd]);
  //   expect(efs.translatePath('../')).toEqual([cwd, cwd]);
  //   expect(efs.translatePath('../../../')).toEqual([cwd, cwd]);
  //   // upper current directory is at cwd for lower
  //   expect(efs.translatePath('.')).toEqual([cwd, cwd]);
  //   // files and directories and links
  //   expect(efs.translatePath('/a')).toEqual(
  //     [
  //       pathNode.posix.join(cwd, 'a.data'),
  //       pathNode.posix.join(cwd, '.a.meta')
  //     ]
  //   );
  //   expect(efs.translatePath('/a///')).toEqual(
  //     [
  //       pathNode.posix.join(cwd, 'a.data'),
  //       pathNode.posix.join(cwd, '.a.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('/a/b')).toEqual(
  //     [
  //       pathNode.posix.join(cwd, 'a.data/b.data'),
  //       pathNode.posix.join(cwd, 'a.data/.b.meta')
  //     ]
  //   );
  //   expect(efs.translatePath('./a')).toEqual(
  //     [
  //       pathNode.posix.join(cwd, 'a.data'),
  //       pathNode.posix.join(cwd, '.a.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('./a/b')).toEqual(
  //     [
  //       pathNode.posix.join(cwd, 'a.data/b.data'),
  //       pathNode.posix.join(cwd, 'a.data/.b.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('./a/../b')).toEqual(
  //     [
  //       pathNode.posix.join(cwd, 'b.data'),
  //       pathNode.posix.join(cwd, '.b.meta')
  //     ]
  //   );
  // });
  // test('translating paths at a directory', async () => {
  //   const dirDir = pathNode.posix.join(cwd, 'dir');
  //   const efs = new EncryptedFS(key, fs, 'dir');
  //   expect(efs.getCwd()).toBe('/');
  //   expect(efs.cwdLower).toBe(dirDir);
  //   // empty string is empty string
  //   expect(efs.translatePath('')).toEqual(['', '']);
  //   // upper root translates to the cwdLower
  //   expect(efs.translatePath('/')).toEqual([dirDir, dirDir]);
  //   expect(efs.translatePath('////')).toEqual([dirDir, dirDir]);
  //   expect(efs.translatePath('/../')).toEqual([dirDir, dirDir]);
  //   expect(efs.translatePath('../')).toEqual([dirDir, dirDir]);
  //   expect(efs.translatePath('../../../')).toEqual([dirDir, dirDir]);
  //   // upper current directory is at dirDir for lower
  //   expect(efs.translatePath('.')).toEqual([dirDir, dirDir]);
  //   // files and directories and links
  //   expect(efs.translatePath('/a')).toEqual(
  //     [
  //       pathNode.posix.join(dirDir, 'a.data'),
  //       pathNode.posix.join(dirDir, '.a.meta')
  //     ]
  //   );
  //   expect(efs.translatePath('/a///')).toEqual(
  //     [
  //       pathNode.posix.join(dirDir, 'a.data'),
  //       pathNode.posix.join(dirDir, '.a.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('/a/b')).toEqual(
  //     [
  //       pathNode.posix.join(dirDir, 'a.data/b.data'),
  //       pathNode.posix.join(dirDir, 'a.data/.b.meta')
  //     ]
  //   );
  //   expect(efs.translatePath('./a')).toEqual(
  //     [
  //       pathNode.posix.join(dirDir, 'a.data'),
  //       pathNode.posix.join(dirDir, '.a.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('./a/b')).toEqual(
  //     [
  //       pathNode.posix.join(dirDir, 'a.data/b.data'),
  //       pathNode.posix.join(dirDir, 'a.data/.b.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('./a/../b')).toEqual(
  //     [
  //       pathNode.posix.join(dirDir, 'b.data'),
  //       pathNode.posix.join(dirDir, '.b.meta')
  //     ]
  //   );
  // });
  // test('translating paths at root', async () => {
  //   const efs = new EncryptedFS(key, fs, dataDir);
  //   expect(efs.getCwd()).toBe('/');
  //   expect(efs.cwdLower).toBe(dataDir);
  //   // empty string is empty string
  //   expect(efs.translatePath('')).toEqual(['', '']);
  //   // upper root translates to the cwdLower
  //   expect(efs.translatePath('/')).toEqual([dataDir, dataDir]);
  //   expect(efs.translatePath('////')).toEqual([dataDir, dataDir]);
  //   expect(efs.translatePath('/../')).toEqual([dataDir, dataDir]);
  //   expect(efs.translatePath('../')).toEqual([dataDir, dataDir]);
  //   expect(efs.translatePath('../../../')).toEqual([dataDir, dataDir]);
  //   // upper current directory is at dataDir for lower
  //   expect(efs.translatePath('.')).toEqual([dataDir, dataDir]);
  //   // files and directories and links
  //   expect(efs.translatePath('/a')).toEqual(
  //     [
  //       pathNode.posix.join(dataDir, 'a.data'),
  //       pathNode.posix.join(dataDir, '.a.meta')
  //     ]
  //   );
  //   expect(efs.translatePath('/a///')).toEqual(
  //     [
  //       pathNode.posix.join(dataDir, 'a.data'),
  //       pathNode.posix.join(dataDir, '.a.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('/a/b')).toEqual(
  //     [
  //       pathNode.posix.join(dataDir, 'a.data/b.data'),
  //       pathNode.posix.join(dataDir, 'a.data/.b.meta')
  //     ]
  //   );
  //   expect(efs.translatePath('./a')).toEqual(
  //     [
  //       pathNode.posix.join(dataDir, 'a.data'),
  //       pathNode.posix.join(dataDir, '.a.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('./a/b')).toEqual(
  //     [
  //       pathNode.posix.join(dataDir, 'a.data/b.data'),
  //       pathNode.posix.join(dataDir, 'a.data/.b.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('./a/../b')).toEqual(
  //     [
  //       pathNode.posix.join(dataDir, 'b.data'),
  //       pathNode.posix.join(dataDir, '.b.meta')
  //     ]
  //   );
  // });
  // test('translating paths at up one directory', async () => {
  //   const upDir = pathNode.posix.resolve('..');
  //   const efs = new EncryptedFS(key, fs, upDir);
  //   expect(efs.getCwd()).toBe('/');
  //   expect(efs.cwdLower).toBe(upDir);
  //   // empty string is empty string
  //   expect(efs.translatePath('')).toEqual(['', '']);
  //   // upper root translates to the cwdLower
  //   expect(efs.translatePath('/')).toEqual([upDir, upDir]);
  //   expect(efs.translatePath('////')).toEqual([upDir, upDir]);
  //   expect(efs.translatePath('/../')).toEqual([upDir, upDir]);
  //   expect(efs.translatePath('../')).toEqual([upDir, upDir]);
  //   expect(efs.translatePath('../../../')).toEqual([upDir, upDir]);
  //   // upper current directory is at upDir for lower
  //   expect(efs.translatePath('.')).toEqual([upDir, upDir]);
  //   // files and directories and links
  //   expect(efs.translatePath('/a')).toEqual(
  //     [
  //       pathNode.posix.join(upDir, 'a.data'),
  //       pathNode.posix.join(upDir, '.a.meta')
  //     ]
  //   );
  //   expect(efs.translatePath('/a///')).toEqual(
  //     [
  //       pathNode.posix.join(upDir, 'a.data'),
  //       pathNode.posix.join(upDir, '.a.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('/a/b')).toEqual(
  //     [
  //       pathNode.posix.join(upDir, 'a.data/b.data'),
  //       pathNode.posix.join(upDir, 'a.data/.b.meta')
  //     ]
  //   );
  //   expect(efs.translatePath('./a')).toEqual(
  //     [
  //       pathNode.posix.join(upDir, 'a.data'),
  //       pathNode.posix.join(upDir, '.a.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('./a/b')).toEqual(
  //     [
  //       pathNode.posix.join(upDir, 'a.data/b.data'),
  //       pathNode.posix.join(upDir, 'a.data/.b.meta'),
  //     ]
  //   );
  //   expect(efs.translatePath('./a/../b')).toEqual(
  //     [
  //       pathNode.posix.join(upDir, 'b.data'),
  //       pathNode.posix.join(upDir, '.b.meta')
  //     ]
  //   );
  // });
});
