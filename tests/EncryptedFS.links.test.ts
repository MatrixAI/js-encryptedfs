import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import process from 'process';
import * as vfs from 'virtualfs';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import * as utils from '@/utils';
import EncryptedFS from '@/EncryptedFS';
import { EncryptedFSError, errno } from '@/EncryptedFSError';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';

describe('EncryptedFS Symlinks', () => {
  const logger = new Logger('EncryptedFS Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  // const cwd = process.cwd();
  let dataDir: string;
  let dbPath: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
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
      logger,
    });
    await db.start();
    iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger,
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
  test('symlink stat makes sense', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.writeFile(`a`, 'data');
    await efs.symlink(`a`, `link-to-a`);
    await efs.lchown('link-to-a', 1000, 1000);
    const stat = (await efs.lstat(`link-to-a`)) as vfs.Stat;
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(false);
    expect(stat.isBlockDevice()).toStrictEqual(false);
    expect(stat.isCharacterDevice()).toStrictEqual(false);
    expect(stat.isSocket()).toStrictEqual(false);
    expect(stat.isSymbolicLink()).toStrictEqual(true);
    expect(stat.isFIFO()).toStrictEqual(false);
    expect(stat.uid).toBe(1000);
    expect(stat.gid).toBe(1000);
  });
  test('rmdir does not traverse the last symlink', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir(`directory`);
    await efs.symlink(`directory`, `linktodirectory`);
    await expect(efs.rmdir(`linktodirectory`)).rejects.toThrow();
  });
  test('symlink paths can contain multiple slashes', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir(`dir`);
    await efs.writeFile(`dir/test`, 'hello');
    await efs.symlink(`///dir////test`, `linktodirtest`);
    const linkContents = await efs.readFile(`linktodirtest`);
    await expect(efs.readFile(`dir/test`)).resolves.toEqual(linkContents);
  });
  test('is able to add and traverse symlinks transitively', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir(`test`);
    const buffer = Buffer.from('Hello World');
    await efs.writeFile(`test/hello-world.txt`, buffer);
    await efs.symlink(`test`, `linktotestdir`, 'dir');
    await expect(efs.readlink(`linktotestdir`)).resolves.toEqual(`test`);
    await expect(efs.readdir(`linktotestdir`)).resolves.toContain(
      'hello-world.txt',
    );
    await efs.symlink(`linktotestdir/hello-world.txt`, `linktofile`);
    await efs.symlink(`linktofile`, `linktolink`);
    await expect(
      efs.readFile(`linktofile`, { encoding: 'utf-8' }),
    ).resolves.toEqual('Hello World');
    await expect(
      efs.readFile(`linktolink`, { encoding: 'utf-8' }),
    ).resolves.toEqual('Hello World');
  });
  test('unlink does not traverse symlinks', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir(`test`);
    const buffer = Buffer.from('Hello World');
    await efs.writeFile(`test/hello-world.txt`, buffer);
    await efs.symlink(`test`, `linktotestdir`, 'dir');
    await efs.symlink(`linktotestdir/hello-world.txt`, `linktofile`);
    await efs.unlink(`linktofile`);
    await efs.unlink(`linktotestdir`);
    await expect(efs.readdir(`test`)).resolves.toContain('hello-world.txt');
  });
  test('realpath expands symlinks', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.writeFile('/test', Buffer.from('Hello'));
    await efs.symlink('./test', '/linktotest');
    await efs.mkdir('/dirwithlinks');
    await efs.symlink('../linktotest', '/dirwithlinks/linktolink');
    const realPath = await efs.realpath('/dirwithlinks/linktolink');
    expect(realPath).toBe('/test');
  });
  test('resolves symlink loops 1', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.symlink('/test', '/test');
    await expect(efs.readFile('/test')).rejects.toThrow();
  });

  test('resolves symlink loops 2', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir('/dirtolink');
    await efs.symlink('/dirtolink/test', '/test');
    await efs.symlink('/test', '/dirtolink/test');
    await expect(efs.readFile('/test/non-existent')).rejects.toThrow();
  });
  test('is able to add and traverse symlinks transitively', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir('/test');
    const buf = Buffer.from('Hello World');
    await efs.writeFile('/test/hello-world.txt', buf);
    await efs.symlink('/test', '/linktotestdir');
    await expect(efs.readlink('/linktotestdir')).resolves.toBe('/test');
    await expect(efs.readdir('/linktotestdir')).resolves.toEqual([
      'hello-world.txt',
    ]);
    await efs.symlink('/linktotestdir/hello-world.txt', '/linktofile');
    await efs.symlink('/linktofile', '/linktolink');
    await expect(
      efs.readFile('/linktofile', { encoding: 'utf8' }),
    ).resolves.toBe('Hello World');
    await expect(
      efs.readFile('/linktolink', { encoding: 'utf8' }),
    ).resolves.toBe('Hello World');
  });
  test('is able to traverse relative symlinks', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir('/test');
    const buf = Buffer.from('Hello World');
    await efs.writeFile('/a', buf);
    await efs.symlink('../a', '/test/linktoa');
    await expect(
      efs.readFile('/test/linktoa', { encoding: 'utf-8' }),
    ).resolves.toBe('Hello World');
  });
  test('should not create hardlinks to directories', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir(`test`);
    await expect(efs.link(`test`, `hardlinkttotest`)).rejects.toThrow();
  });
  test('multiple hardlinks to the same file', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir(`test`);
    await efs.writeFile(`test/a`, '');
    await efs.link(`test/a`, `test/b`);
    const inoA = ((await efs.stat(`test/a`)) as vfs.Stat).ino;
    const inoB = ((await efs.stat(`test/b`)) as vfs.Stat).ino;
    expect(inoA).toEqual(inoB);
    const readB = await efs.readFile(`test/b`);
    await expect(efs.readFile(`test/a`)).resolves.toEqual(readB);
  });
});
