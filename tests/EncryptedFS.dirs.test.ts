import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import * as vfs from 'virtualfs';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import * as utils from '@/utils';
import EncryptedFS from '@/EncryptedFS';
import { EncryptedFSError, errno } from '@/EncryptedFSError';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import { expectError } from './utils';

describe('EncryptedFS Directories', () => {
  const logger = new Logger('EncryptedFS Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
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
  test('dir stat makes sense', async () => {
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
    const stat = (await efs.stat(`dir`)) as vfs.Stat;
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(true);
    expect(stat.isBlockDevice()).toStrictEqual(false);
    expect(stat.isCharacterDevice()).toStrictEqual(false);
    expect(stat.isSocket()).toStrictEqual(false);
    expect(stat.isSymbolicLink()).toStrictEqual(false);
    expect(stat.isFIFO()).toStrictEqual(false);
  });
  test('has an empty root directory at startup', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await expect(efs.readdir('/')).resolves.toEqual([]);
    const stat = (await efs.stat('/')) as vfs.Stat;
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(true);
    expect(stat.isSymbolicLink()).toStrictEqual(false);
  });
  test('is able to make directories', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir(`first`);
    await expect(efs.exists('first')).resolves.toBe(true);
    await efs.mkdir(`first//sub/`);
    await efs.mkdir(`first/sub/subsub`);
    await efs.mkdir(`first/sub2`);
    await efs.mkdir(`backslash\\dir`);
    expect((await efs.readdir(`.`)).sort()).toStrictEqual(
      ['backslash\\dir', 'first'].sort(),
    );
    expect((await efs.readdir(`first/`)).sort()).toStrictEqual(
      ['sub', 'sub2'].sort(),
    );
    await efs.mkdirp(`a/depth/sub/dir`);
    await expect(efs.exists(`a/depth/sub`)).resolves.toBe(true);
    const stat = (await efs.stat(`a/depth/sub`)) as vfs.Stat;
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(true);
  });
  test('should not make the root directory', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await expectError(efs.mkdir('/'), errno.EEXIST);
  });
  test('creating temporary directories', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    const tempSubDir = `dir`;
    await efs.mkdir(tempSubDir);
    const buffer = Buffer.from('abc');
    await efs.writeFile(`${tempSubDir}/test`, buffer);
    await expect(
      efs.readFile(`${tempSubDir}/test`, { encoding: 'utf8' }),
    ).resolves.toEqual(buffer.toString());
  });
  test('should be able to remove directories', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir('first');
    await efs.mkdir('first//sub/');
    await efs.mkdir('first/sub2');
    await efs.mkdir('backslash\\dir');
    await efs.rmdir('first/sub//');
    const firstlist = await efs.readdir('/first');
    expect(firstlist).toEqual(['sub2']);
    await efs.rmdir('first/sub2');
    await efs.rmdir('first');
    await expect(efs.exists('first')).resolves.toBeFalsy();
    await expectError(efs.access('first'), errno.ENOENT);
    await expectError(efs.readdir('first'), errno.ENOENT);
    const rootlist = await efs.readdir('.');
    expect(rootlist).toEqual(['backslash\\dir']);
  });
  test('can rename a directory', async () => {
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
    await expect(efs.readdir('.')).resolves.toEqual(['test']);
    await efs.rename('/test', '/test-rename');
    await expect(efs.readdir('.')).resolves.toEqual(['test-rename']);
  });
  test('directory file descriptors capabilities', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    const dirName = `dir`;
    await efs.mkdir(dirName);
    const dirfd = await efs.open(dirName, 'r');
    await efs.fsync(dirfd);
    await efs.fdatasync(dirfd);
    await efs.fchmod(dirfd, 0o666);
    await efs.fchown(dirfd, 0, 0);
    const date = new Date();
    await efs.futimes(dirfd, date, date);
    const stats = (await efs.fstat(dirfd)) as vfs.Stat;
    expect(stats.atime.toJSON()).toEqual(date.toJSON());
    expect(stats.mtime.toJSON()).toEqual(date.toJSON());
    await efs.close(dirfd);
  });
  test('directory file descriptor errors', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    const dirName = `dir`;
    await efs.mkdir(dirName);
    // opening it without O_RDONLY would result in EISDIR
    const dirfd = await efs.open(
      dirName,
      vfs.constants.O_RDONLY | vfs.constants.O_DIRECTORY,
    );
    const buffer = Buffer.alloc(10);
    await expectError(efs.ftruncate(dirfd), errno.EINVAL);
    await expectError(efs.read(dirfd, buffer, 0, 10), errno.EISDIR);
    await expectError(efs.write(dirfd, buffer), errno.EBADF);
    await expectError(efs.readFile(dirfd), errno.EISDIR);
    await expectError(efs.writeFile(dirfd, `test`), errno.EBADF);
    await efs.close(dirfd);
  });
  test("directory file descriptor's inode nlink becomes 0 after deletion of the directory", async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir('/dir');
    const fd = await efs.open('/dir', 'r');
    await efs.rmdir('/dir');
    const stat = (await efs.fstat(fd)) as vfs.Stat;
    expect(stat.nlink).toBe(1);
    await efs.close(fd);
  });
  test('cannot create inodes within a deleted current directory', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.writeFile('/dummy', 'hello');
    await efs.mkdir('/removed');
    await efs.chdir('/removed');
    await efs.rmdir('../removed');
    await expectError(efs.writeFile('./a', 'abc'), errno.ENOENT);
    await expectError(efs.mkdir('./b'), errno.ENOENT);
    await expectError(efs.symlink('../dummy', 'c'), errno.ENOENT);
    await expectError(efs.link('../dummy', 'd'), errno.ENOENT);
  });
  test('cannot delete current directory using .', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir('/removed');
    await efs.chdir('/removed');
    await expect(efs.rmdir('.')).rejects.toThrow();
  });
  test('cannot delete parent directory using .. even when current directory is deleted', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdirp('/removeda/removedb');
    await efs.chdir('/removeda/removedb');
    await efs.rmdir('../removedb');
    await efs.rmdir('../../removeda');
    await expect(efs.rmdir('..')).rejects.toThrow();
  });
  test('cannot rename the current or parent directory to a subdirectory', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdir('/cwd');
    await efs.chdir('/cwd');
    await expect(efs.rename('.', 'subdir')).rejects.toThrow();
    await efs.mkdir('/cwd/cwd');
    await efs.chdir('/cwd/cwd');
    await expect(efs.rename('..', 'subdir')).rejects.toThrow();
  });
  test('cannot rename where the old path is a strict prefix of the new path', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await efs.mkdirp('/cwd1/cwd2');
    await efs.chdir('/cwd1/cwd2');
    await expect(efs.rename('../cwd2', 'subdir')).rejects.toThrow();
    await efs.mkdir('/cwd1/cwd2/cwd3');
    await expect(efs.rename('./cwd3', './cwd3/cwd4')).rejects.toThrow();
  });
});
