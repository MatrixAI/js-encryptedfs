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
  describe('Navigation', () => {
    test('should be able to navigate before root', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const buffer = Buffer.from('Hello World');
      await efs.mkdir(`first`);
      await efs.writeFile(`hello-world.txt`, buffer);
      let stat = await efs.stat(`first/../../../../../../first`) as vfs.Stat;
      expect(stat.isFile()).toStrictEqual(false);
      expect(stat.isDirectory()).toStrictEqual(true);
      stat = await efs.stat(`first/../../../../../../hello-world.txt`) as vfs.Stat;
      expect(stat.isFile()).toStrictEqual(true);
      expect(stat.isDirectory()).toStrictEqual(false);
    });
    test('trailing slash refers to the directory instead of a file', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile(`abc`, '');
      await expect(efs.access(`abc/`, undefined)).rejects.toThrow();
      await expect(efs.access(`abc/.`, undefined)).rejects.toThrow();
      await expect(efs.mkdir(`abc/.`)).rejects.toThrow();
      await expect(efs.mkdir(`abc/`)).rejects.toThrow();
    });
    test('trailing slash works for non-existent directories when intending to create them', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir(`abc/`);
      const stat = await efs.stat(`abc/`) as vfs.Stat;
      expect(stat.isDirectory()).toStrictEqual(true);
    });
    test('trailing `/.` for mkdirSync should result in errors', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await expect(efs.mkdir(`abc/.`)).rejects.toThrow();
      await efs.mkdir(`abc`)
      await expect(efs.mkdir(`abc/.`)).rejects.toThrow();
    });
    test('navigating invalid paths', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdirp('/test/a/b/c');
      await efs.mkdirp('/test/a/bc');
      await efs.mkdirp('/test/abc');
      await expect(efs.readdir('/test/abc/a/b/c')).rejects.toThrow(new EncryptedFSError(errno.ENOENT));
      await expect(efs.readdir('/abc')).rejects.toThrow(new EncryptedFSError(errno.ENOENT));
      await expect(efs.stat('/test/abc/a/b/c')).rejects.toThrow(new EncryptedFSError(errno.ENOENT));
      await expect(efs.mkdir('/test/abc/a/b/c')).rejects.toThrow(new EncryptedFSError(errno.EEXIST));
      await expect(efs.writeFile('/test/abc/a/b/c', 'Hello')).rejects.toThrow(new EncryptedFSError(errno.EEXIST));
      await expect(efs.readFile('/test/abc/a/b/c')).rejects.toThrow();
      await expect(efs.readFile('/test/abcd')).rejects.toThrow();
      await expect(efs.mkdir('/test/abcd/dir')).rejects.toThrow();
      await expect(efs.unlink('/test/abcd')).rejects.toThrow();
      await expect(efs.unlink('/test/abcd/file')).rejects.toThrow();
      await expect(efs.stat('/test/a/d/b/c')).rejects.toThrow();
      await expect(efs.stat('/test/abcd')).rejects.toThrow();
    });
    test('various failure situations', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdirp('/test/dir');
      await efs.mkdirp('/test/dir');
      await efs.writeFile('/test/file', 'Hello');
      await expect(efs.writeFile("/test/dir", "Hello")).rejects.toThrow();
      await expect(efs.writeFile('/', 'Hello')).rejects.toThrow();
      await expect(efs.rmdir('/')).rejects.toThrow();
      await expect(efs.unlink('/')).rejects.toThrow();
      await expect(efs.mkdir('/test/dir')).rejects.toThrow();
      await expect(efs.mkdir('/test/file')).rejects.toThrow();
      await expect(efs.mkdirp('/test/file')).rejects.toThrow();
      await expect(efs.readdir('/test/file')).rejects.toThrow();
      await expect(efs.readlink('/test/dir')).rejects.toThrow();
      await expect(efs.readlink('/test/file')).rejects.toThrow();
    });
    test('cwd returns the absolute fully resolved path', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdirp('/a/b');
      await efs.symlink('/a/b', '/c');
      await efs.chdir('/c');
      const cwd = efs.cwd;
      expect(cwd).toBe('/a/b');
    });
    test('cwd still works if the current directory is deleted', async () => {
      // nodejs process.cwd() will actually throw ENOENT
      // but making it work in VFS is harmless
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
      await efs.rmdir('../removed');
      expect(efs.cwd).toBe('/removed');
    });
    test('deleted current directory can still use . and .. for traversal', async () => {
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
      const statRoot = await efs.stat('/') as vfs.Stat;
      await efs.chdir('/removed');
      const statCurrent1 = await efs.stat('.') as vfs.Stat;
      await efs.rmdir('../removed');
      const statCurrent2 = await efs.stat('.') as vfs.Stat;
      const statParent = await efs.stat('..') as vfs.Stat;
      expect(statCurrent1.ino).toBe(statCurrent2.ino);
      expect(statRoot.ino).toBe(statParent.ino);
      expect(statCurrent2.nlink).toBe(1);
      expect(statParent.nlink).toBe(3);
      const dentryCurrent = await efs.readdir('.');
      const dentryParent = await efs.readdir('..');
      expect(dentryCurrent).toEqual([]);
      expect(dentryParent).toEqual([]);
    });
    test('can still chdir when both current and parent directories are deleted', async () => {
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
      await efs.chdir('..');
      await efs.chdir('..');
      const path = efs.cwd;
      expect(path).toBe('/');
    });
    test('cannot chdir into a directory without execute permissions', async () => {
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
      await efs.chmod('/dir', 0o666);
      efs.uid = 1000;
      await expect(efs.chdir('/dir')).rejects.toThrow();
    });
  });
  describe('Directories', () => {
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
      const stat = await efs.stat(`dir`) as vfs.Stat;
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
      const stat = await efs.stat('/') as vfs.Stat;
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
      expect((await efs.readdir(`.`)).sort()).toStrictEqual(['backslash\\dir', 'first'].sort());
      expect((await efs.readdir(`first/`)).sort()).toStrictEqual(['sub', 'sub2'].sort());
      await efs.mkdirp(`a/depth/sub/dir`);
      await expect(efs.exists(`a/depth/sub`)).resolves.toBe(true);
      const stat = await efs.stat(`a/depth/sub`) as vfs.Stat;
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
      await expect(efs.mkdir('/')).rejects.toThrow();
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
      await expect(efs.access('first')).rejects.toThrow();
      await expect(efs.readdir('first')).rejects.toThrow();
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
      const stats = await efs.fstat(dirfd) as vfs.Stat;
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
      await expect(efs.ftruncate(dirfd)).rejects.toThrow();
      await expect(efs.read(dirfd, buffer, 0, 10)).rejects.toThrow();
      await expect(efs.write(dirfd, buffer)).rejects.toThrow();
      await expect(efs.readFile(dirfd)).rejects.toThrow();
      await expect(efs.writeFile(dirfd, `test`)).rejects.toThrow();
      await efs.close(dirfd);
    });
    test('directory file descriptor\'s inode nlink becomes 0 after deletion of the directory', async () => {
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
      const stat = await efs.fstat(fd) as vfs.Stat;
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
      await expect(efs.writeFile('./a', 'abc')).rejects.toThrow();
      await expect(efs.mkdir('./b')).rejects.toThrow();
      await expect(efs.symlink('../dummy', 'c')).rejects.toThrow();
      await expect(efs.link('../dummy', 'd')).rejects.toThrow();
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
  describe('Files', () => {
    test('file stat makes sense', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile(`test`, 'test data');
      const stat = await efs.stat(`test`) as vfs.Stat;
      expect(stat.isFile()).toStrictEqual(true);
      expect(stat.isDirectory()).toStrictEqual(false);
      expect(stat.isBlockDevice()).toStrictEqual(false);
      expect(stat.isCharacterDevice()).toStrictEqual(false);
      expect(stat.isSocket()).toStrictEqual(false);
      expect(stat.isSymbolicLink()).toStrictEqual(false);
      expect(stat.isFIFO()).toStrictEqual(false);
    });
    test('opening files', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open('testFile', vfs.constants.O_CREAT);
      let test = await efs.readdir('.');
      expect(test).toStrictEqual(['testFile']);
      await efs.close(fd);
    });
    test('reading and writing files', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      let fd = await efs.open('testFile', 'w+');
      let test = await efs.readdir('.');
      expect(test).toStrictEqual(['testFile']);
      let readBuffer = Buffer.alloc(25);
      const compBuffer = Buffer.alloc(25);
      await efs.read(fd, readBuffer, 0, 25);
      expect(readBuffer).toStrictEqual(compBuffer);
      const writeBuffer = Buffer.from('Test Encrypted FileSystem');
      readBuffer = Buffer.alloc(25);
      await efs.write(fd, writeBuffer, 0, 25, 0);
      await efs.read(fd, readBuffer, 0, 25, 0);
      expect(readBuffer).toStrictEqual(writeBuffer);
      let readString = await efs.readFile(fd, { encoding: 'utf8' });
      expect(readString).toStrictEqual(writeBuffer.toString());
      await efs.close(fd);
      fd = await efs.open('testFile', 'w+');
      const writeFileBuffer = Buffer.from('New Test EncryptedFS');
      await efs.writeFile(fd, writeFileBuffer);
      readString = await efs.readFile('testFile', { encoding: 'utf8' });
      expect(readString).toEqual(writeFileBuffer.toString());
      await efs.close(fd);
    });
    test('can make files', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const buffer = Buffer.from('Hello World', 'utf8');
      await efs.writeFile(`hello-world`, buffer);
      await expect(efs.readFile(`hello-world`)).resolves.toEqual(buffer);
      await expect(efs.readFile(`hello-world`, { encoding: 'utf8' })).resolves.toBe('Hello World');
      await efs.writeFile(`a`, 'Test', { encoding: 'utf-8' });
      await expect(efs.readFile(`a`, { encoding: 'utf-8' })).resolves.toBe('Test');
      const stat = await efs.stat(`a`) as vfs.Stat;
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.isDirectory()).toBe(false);
      await efs.writeFile(`b`, 'Test', { encoding: 'utf8' });
      await expect(efs.readFile(`b`, { encoding: 'utf-8' })).resolves.toEqual('Test');
      await expect(efs.readFile(`other-file`)).rejects.toThrow();
      await expect(efs.readFile(`other-file`, { encoding: 'utf8' })).rejects.toThrow();
    });
    test('can write 50 files', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      let content = '';
      for (let i = 0; i < 50; i++) {
        const name = 'secret';
        content += name + i.toString();
        await efs.writeFile(name, content);
        const files = await efs.readFile(name, { encoding: 'utf8' });
        expect(files).toStrictEqual(content);
      }
    });
    test('read calling styles', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello World';
      const buf = Buffer.from(str).fill(0);
      await efs.writeFile(`test`, str);
      const fd = await efs.open(`test`, 'r+');
      let bytesRead: number;
      bytesRead = await efs.read(fd, buf);
      expect(bytesRead).toEqual(0);
      bytesRead = await efs.read(fd, buf, 0);
      expect(bytesRead).toEqual(0);
      bytesRead = await efs.read(fd, buf, 0, 0);
      expect(bytesRead).toEqual(0);
      bytesRead = await efs.read(fd, buf, 0, 1);
      expect(bytesRead).toEqual(1);
      bytesRead = await efs.read(fd, buf, 0, 0);
      expect(bytesRead).toEqual(0);
      bytesRead = await efs.read(fd, buf, 0, 1);
      expect(bytesRead).toEqual(1);
      await efs.close(fd);
    });
    test('write calling styles', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open(`test`, 'w');
      const str = 'Hello World';
      const buf = Buffer.from(str);
      let bytesWritten;
      bytesWritten = await efs.write(fd, buf);
      expect(bytesWritten).toEqual(11);
      bytesWritten = await efs.write(fd, buf, 0);
      expect(bytesWritten).toEqual(11);
      await efs.write(fd, buf, 0, buf.length);
      await efs.write(fd, buf, 0, buf.length);
      await efs.writeFile(fd, str);
      await efs.writeFile(fd, str);
      await efs.writeFile(fd, str);
      await efs.close(fd);
    });
    test('readFile calling styles', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello World';
      const buf = Buffer.from(str);
      await efs.writeFile(`test`, buf);
      const fd = await efs.open(`test`, 'r+');
      let contents: Buffer | string;
      contents = await efs.readFile(`test`);
      expect(contents).toEqual(buf);
      contents = await efs.readFile(`test`, {
        encoding: 'utf8',
        flag: 'r',
      });
      expect(contents).toEqual(str);
      await efs.close(fd);
    });
    test('writeFileSync calling styles', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open(`test`, 'w+');
      const str = 'Hello World';
      const buf = Buffer.from(str);
      await efs.writeFile(`test`, str);
      await expect(efs.readFile(`test`)).resolves.toEqual(buf);
      await efs.writeFile(`test`, str, {
        encoding: 'utf8',
        mode: 0o666,
        flag: 'w',
      });
      await expect(efs.readFile(`test`)).resolves.toEqual(buf);
      await efs.writeFile(`test`, buf);
      await expect(efs.readFile(`test`)).resolves.toEqual(buf);
      await efs.writeFile(fd, str);
      await expect(efs.readFile(`test`)).resolves.toEqual(buf);
      await efs.writeFile(fd, str, { encoding: 'utf8', mode: 0o666, flag: 'w' });
      await expect(efs.readFile(`test`)).resolves.toEqual(buf);
      await efs.writeFile(fd, buf);
      await expect(efs.readFile(`test`)).resolves.toEqual(buf);
      await efs.close(fd);
    });
    test('can copy files', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const buffer = Buffer.from('Hello World');
      await efs.mkdir('dir');
      await efs.writeFile(`dir/hello-world`, buffer);
      await efs.copyFile('dir/hello-world', 'hello-universe');
      await expect(efs.readFile('hello-universe')).resolves.toEqual(buffer);
    });
    test('appendFile moves with the fd position', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open('/fdtest', 'w+');
      await efs.appendFile(fd, 'a');
      await efs.appendFile(fd, 'a');
      await efs.appendFile(fd, 'a');
      await expect(efs.readFile('/fdtest', { encoding:'utf8' })).resolves.toBe('aaa');
      await efs.close(fd);
    });
    test('read moves with the fd position', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'abc';
      const buf = Buffer.from(str).fill(0);
      await efs.writeFile('/fdtest', str);
      const fd = await efs.open('/fdtest', 'r+');
      await efs.read(fd, buf, 0, 1);
      await efs.read(fd, buf, 1, 1);
      await efs.read(fd, buf, 2, 1);
      expect(buf).toEqual(Buffer.from(str));
      await efs.close(fd);
    });
    test('write moves with the fd position', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open('/fdtest', 'w+');
      await efs.write(fd, 'a');
      await efs.write(fd, 'a');
      await efs.write(fd, 'a');
      await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toBe('aaa');
      await efs.close(fd);
    });

    test('read does not change fd position according to position parameter', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      let buf = Buffer.alloc(3);
      let fd;
      let bytesRead;
      // reading from position 0 doesn't move the fd from the end
      fd = await efs.open('/fdtest', 'w+');
      await efs.write(fd, 'abcdef');
      buf = Buffer.alloc(3);
      bytesRead = await efs.read(fd, buf, 0, buf.length);
      expect(bytesRead).toBe(0);
      bytesRead = await efs.read(fd, buf, 0, buf.length, 0);
      expect(bytesRead).toBe(3);
      expect(buf).toEqual(Buffer.from('abc'));
      await efs.write(fd, 'ghi');
      await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toEqual('abcdefghi');
      await efs.close(fd);
      // reading with position null does move the fd
      await efs.writeFile('/fdtest', 'abcdef');
      fd = await efs.open('/fdtest', 'r+');
      bytesRead = await efs.read(fd, buf, 0, buf.length);
      expect(bytesRead).toBe(3);
      await efs.write(fd, 'ghi');
      await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toBe('abcghi');
      await efs.close(fd);
      // reading with position 0 doesn't move the fd from the start
      await efs.writeFile('/fdtest', 'abcdef');
      fd = await efs.open('/fdtest', 'r+');
      buf = Buffer.alloc(3);
      bytesRead = await efs.read(fd, buf, 0, buf.length, 0);
      expect(bytesRead).toBe(3);
      await efs.write(fd, 'ghi');
      await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toEqual('ghidef');
      await efs.close(fd);
      // reading with position 3 doesn't move the fd from the start
      await efs.writeFile('/fdtest', 'abcdef');
      fd = await efs.open('/fdtest', 'r+');
      buf = Buffer.alloc(3);
      bytesRead = await efs.read(fd, buf, 0, buf.length, 3);
      expect(bytesRead).toBe(3);
      await efs.write(fd, 'ghi');
      await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toEqual('ghidef');
      await efs.close(fd);
    });

    test('write does not change fd position according to position parameter', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open('./testy', 'w+');
      await efs.write(fd, 'abcdef');
      await efs.write(fd, 'ghi', 0);
      await efs.write(fd, 'jkl');
      await expect(efs.readFile('./testy', { encoding: 'utf8' })).resolves.toEqual('ghidefjkl');
      await efs.close(fd);
    });

    test('readFile moves with fd position', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      let fd;
      fd = await efs.open('/fdtest', 'w+');
      await efs.write(fd, 'starting');
      await expect(efs.readFile(fd, { encoding: 'utf-8' })).resolves.toEqual('');
      await efs.close(fd);
      fd = await efs.open('/fdtest', 'r+');
      await expect(efs.readFile(fd, { encoding: 'utf-8' })).resolves.toEqual('starting');
      await efs.write(fd, 'ending');
      await expect(efs.readFile('/fdtest', { encoding: 'utf-8' })).resolves.toEqual('startingending');
      await efs.close(fd);
    });
    test('writeFile writes from the beginning, and does not move the fd position', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open('/fdtest', 'w+');
      await efs.write(fd, 'a');
      await efs.write(fd, 'a');
      await efs.writeFile(fd, 'b');
      await efs.write(fd, 'c');
      await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toEqual('bac');
      await efs.close(fd);
    });
    test('O_APPEND makes sure that writes always set their fd position to the end', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile('/fdtest', 'abc');
      let buf, fd, bytesRead;
      buf = Buffer.alloc(3);
      // there's only 1 fd position both writes and reads
      fd = await efs.open('/fdtest', 'a+');
      await efs.write(fd, 'def');
      bytesRead = await efs.read(fd, buf, 0, buf.length);
      expect(bytesRead).toBe(0);
      await efs.write(fd, 'ghi');
      await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toEqual('abcdefghi');
      await efs.close(fd);
      // even if read moves to to position 3, write will jump the position to the end
      await efs.writeFile('/fdtest', 'abcdef');
      fd = await efs.open('/fdtest', 'a+');
      buf = Buffer.alloc(3);
      bytesRead = await efs.read(fd, buf, 0, buf.length);
      expect(bytesRead).toBe(3);
      expect(buf).toEqual(Buffer.from('abc'));
      await efs.write(fd, 'ghi');
      await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toEqual('abcdefghi');
      bytesRead = await efs.read(fd, buf, 0, buf.length);
      expect(bytesRead).toBe(0);
      await efs.close(fd);
    });
    test('writeFile and appendFile respects the mode', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      // allow others to read only
      await efs.writeFile('/test1', '', { mode: 0o004 });
      await efs.appendFile('/test2', '', { mode: 0o004 });
      // become the other
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.access('/test1', vfs.constants.R_OK);
      await expect(efs.access('/test1', vfs.constants.W_OK)).rejects.toThrow();
      await efs.access('/test2', vfs.constants.R_OK);
      await expect(efs.access('/test1', vfs.constants.W_OK)).rejects.toThrow();
    });
    test('can seek and overwrite parts of a file', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open('/fdtest', 'w+');
      await efs.write(fd, 'abc');
      const pos = await efs.lseek(fd, -1, vfs.constants.SEEK_CUR);
      expect(pos).toBe(2);
      await efs.write(fd, 'd');
      await efs.close(fd);
      const str = await efs.readFile('/fdtest', { encoding: 'utf8' });
      expect(str).toBe('abd');
    });
    test('can seek beyond the file length and create a zeroed "sparse" file', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile('/fdtest', Buffer.from([0x61, 0x62, 0x63]));
      const fd = await efs.open('/fdtest', 'r+');
      const pos = await efs.lseek(fd, 1, vfs.constants.SEEK_END);
      expect(pos).toBe(4);
      await efs.write(fd, Buffer.from([0x64]));
      await efs.close(fd);
      const buf = await efs.readFile('/fdtest');
      expect(buf).toEqual(Buffer.from([0x61, 0x62, 0x63, 0x00, 0x64]));
    });
    test('fallocate can extend the file length', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open('allocate', 'w');
      const offset = 10;
      const length = 100;
      await efs.fallocate(fd, offset, length);
      const stat = await efs.stat('allocate') as vfs.Stat;
      expect(stat.size).toBe(offset + length);
      await efs.close(fd);
    });
    test('fallocate does not touch existing data', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open('allocate', 'w+');
      const str = 'abcdef';
      await efs.write(fd, str);
      const offset = 100;
      const length = 100;
      await efs.fallocate(fd, offset, length);
      const pos = await efs.lseek(fd, 0);
      expect(pos).toBe(0);
      const buf = Buffer.alloc(str.length);
      await efs.read(fd, buf, 0, buf.length);
      expect(buf.toString()).toBe(str);
      await efs.close(fd);
    });
    test('fallocate will only change ctime', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fd = await efs.open(`allocate`, 'w');
      await efs.write(fd, Buffer.from('abc'));
      const stat = await efs.stat(`allocate`) as vfs.Stat;
      const offset = 0;
      const length = 8000;
      await efs.fallocate(fd, offset, length);
      const stat2 = await efs.stat(`allocate`) as vfs.Stat;
      expect(stat2.size).toEqual(offset + length);
      expect(stat2.ctime > stat.ctime).toEqual(true);
      expect(stat2.mtime).toEqual(stat.mtime);
      expect(stat2.atime).toEqual(stat.atime);
      await efs.close(fd);
    });
    test('truncate and ftruncate will change mtime and ctime', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'abcdef';
      await efs.writeFile(`test`, str);
      const stat = await efs.stat(`test`) as vfs.Stat;
      await efs.truncate(`test`, str.length);
      const stat2 = await efs.stat(`test`) as vfs.Stat;
      expect(stat.mtime < stat2.mtime && stat.ctime < stat2.ctime).toEqual(
        true,
      );
      const fd = await efs.open(`test`, 'r+');
      await efs.ftruncate(fd, str.length);
      const stat3 = await efs.stat(`test`) as vfs.Stat;
      expect(
        stat2.mtime < stat3.mtime && stat2.ctime < stat3.ctime,
      ).toEqual(true);
      await efs.ftruncate(fd, str.length);
      const stat4 = await efs.stat(`test`) as vfs.Stat;
      expect(
        stat3.mtime < stat4.mtime && stat3.ctime < stat4.ctime,
      ).toEqual(true);
      await efs.close(fd);
    });
  });
  describe('Symlinks', () => {
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
      const stat = await efs.lstat(`link-to-a`) as vfs.Stat;
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
      await expect(efs.readdir(`linktotestdir`)).resolves.toContain('hello-world.txt');
      await efs.symlink(`linktotestdir/hello-world.txt`, `linktofile`);
      await efs.symlink(`linktofile`, `linktolink`);
      await expect(efs.readFile(`linktofile`, { encoding: 'utf-8' })).resolves.toEqual('Hello World');
      await expect(efs.readFile(`linktolink`, { encoding: 'utf-8' })).resolves.toEqual('Hello World');
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
      await expect(efs.readdir('/linktotestdir')).resolves.toEqual(['hello-world.txt']);
      await efs.symlink('/linktotestdir/hello-world.txt', '/linktofile');
      await efs.symlink('/linktofile', '/linktolink');
      await expect(efs.readFile('/linktofile', { encoding: 'utf8' })).resolves.toBe('Hello World');
      await expect(efs.readFile('/linktolink', { encoding: 'utf8' })).resolves.toBe('Hello World');
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
      await expect(efs.readFile('/test/linktoa', { encoding: 'utf-8' })).resolves.toBe('Hello World');
    });
  });
  describe('Hardlinks', () => {
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
      const inoA = (await efs.stat(`test/a`) as vfs.Stat).ino;
      const inoB = (await efs.stat(`test/b`) as vfs.Stat).ino;
      expect(inoA).toEqual(inoB);
      const readB = await efs.readFile(`test/b`);
      await expect(efs.readFile(`test/a`)).resolves.toEqual(readB);
    });
  });
  describe('Permissions', () => {
    test('chown changes uid and gid', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir('test');
      await efs.chown(`test`, 1000, 1000);
      const stat = await efs.stat(`test`) as vfs.Stat;
      expect(stat.uid).toEqual(1000);
      expect(stat.gid).toEqual(1000);
    });

    test('chmod with 0 wipes out all permissions', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile(`a`, 'abc');
      await efs.chmod(`a`, 0o000);
      const stat = await efs.stat(`a`) as vfs.Stat;
      expect(stat.mode).toEqual(vfs.constants.S_IFREG);
    });

    test('mkdir and chmod affects the mode', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir(`test`, 0o644);
      await efs.access(`test`, vfs.constants.F_OK | vfs.constants.R_OK | vfs.constants.W_OK);
      await efs.chmod(`test`, 0o444);
      await efs.access(`test`, vfs.constants.F_OK | vfs.constants.R_OK);
    });
    test('umask is correctly applied', async () => {
      const umask = 0o022;
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask,
        logger,
      });
      await efs.writeFile('/file', 'hello world');
      await efs.mkdir('/dir');
      await efs.symlink('/file', '/symlink');
      let stat;
      stat = await efs.stat('/file');
      expect(
        (stat.mode & (vfs.constants.S_IRWXU | vfs.constants.S_IRWXG | vfs.constants.S_IRWXO))
      ).toBe(
        vfs.DEFAULT_FILE_PERM & (~umask)
      );
      stat = await efs.stat('/dir');
      expect(
        (stat.mode & (vfs.constants.S_IRWXU | vfs.constants.S_IRWXG | vfs.constants.S_IRWXO))
      ).toBe(
        vfs.DEFAULT_DIRECTORY_PERM & (~umask)
      );
      // umask is not applied to symlinks
      stat = await efs.lstat('/symlink');
      expect(
        (stat.mode & (vfs.constants.S_IRWXU | vfs.constants.S_IRWXG | vfs.constants.S_IRWXO))
      ).toBe(
        vfs.DEFAULT_SYMLINK_PERM
      );
    });
    test('non-root users can only chown uid if they own the file and they are chowning to themselves', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile('file', 'hello');
      await efs.chown('file', 1000, 1000);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.chown('file', 1000, 1000);
      let error;
      // you cannot give away files
      await expect(efs.chown('file', 2000, 2000)).rejects.toThrow();
      // if you don't own the file, you also cannot change (even if your change is noop)
      efs.uid = 3000;
      await expect(efs.chown('file', 1000, 1000)).rejects.toThrow();
    });
    test('chmod only works if you are the owner of the file', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile('file', 'hello');
      await efs.chown('file', 1000, 1000);
      efs.uid = 1000;
      await efs.chmod('file', 0o000);
      efs.uid = 2000;
      await expect(efs.chmod('file', 0o777)).rejects.toThrow();
    });
    test('permissions are checked in stages of user, group then other', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdirp('/home/1000');
      await efs.chown('/home/1000', 1000, 1000);
      await efs.chdir('/home/1000');
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.writeFile('testfile', 'hello');
      await efs.mkdir('dir');
      await efs.chmod('testfile', 0o764);
      await efs.chmod('dir', 0o764);
      await efs.access(
        'testfile',
        (vfs.constants.R_OK |
         vfs.constants.W_OK |
         vfs.constants.X_OK)
      );
      await efs.access(
        'dir',
        (vfs.constants.R_OK |
         vfs.constants.W_OK |
         vfs.constants.X_OK)
      );
      efs.uid = 2000;
      await efs.access(
        'testfile',
        (vfs.constants.R_OK |
         vfs.constants.W_OK)
      );
      await efs.access(
        'dir',
        (vfs.constants.R_OK |
         vfs.constants.W_OK)
      );
      await expect(efs.access('testfile', vfs.constants.X_OK)).rejects.toThrow();
      await expect(efs.access('dir', vfs.constants.X_OK)).rejects.toThrow();
      efs.gid = 2000;
      await efs.access('testfile', vfs.constants.R_OK);
      await efs.access('dir', vfs.constants.R_OK);
      await expect(efs.access(
          'testfile',
          (fs.constants.W_OK |
           fs.constants.X_OK)
        )).rejects.toThrow();
      await expect(efs.access(
          'dir',
          (fs.constants.W_OK |
           fs.constants.X_OK)
        )).rejects.toThrow();
    });
    test('permissions are checked in stages of user, group then other (using chownSync)', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdirp('/home/1000');
      await efs.chown('/home/1000', 1000, 1000);
      await efs.chdir('/home/1000');
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.writeFile('testfile', 'hello');
      await efs.mkdir('dir');
      await efs.chmod('testfile', 0o764);
      await efs.chmod('dir', 0o764);
      await efs.access(
        'testfile',
        (vfs.constants.R_OK |
         vfs.constants.W_OK |
         vfs.constants.X_OK)
      );
      await efs.access(
        'dir',
        (vfs.constants.R_OK |
         vfs.constants.W_OK |
         vfs.constants.X_OK)
      );
      efs.uid = vfs.DEFAULT_ROOT_UID;
      efs.uid = vfs.DEFAULT_ROOT_GID;
      await efs.chown('testfile', 2000, 1000);
      await efs.chown('dir', 2000, 1000);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.access(
        'testfile',
        (vfs.constants.R_OK |
         vfs.constants.W_OK)
      );
      await efs.access(
        'dir',
        (vfs.constants.R_OK |
         vfs.constants.W_OK)
      );
      await expect(efs.access('testfile', vfs.constants.X_OK)).rejects.toThrow();
      await expect(efs.access('dir', vfs.constants.X_OK)).rejects.toThrow();
      efs.uid = vfs.DEFAULT_ROOT_UID;
      efs.uid = vfs.DEFAULT_ROOT_GID;
      await efs.chown('testfile', 2000, 2000);
      await efs.chown('dir', 2000, 2000);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.access('testfile', vfs.constants.R_OK);
      await efs.access('dir', vfs.constants.R_OK);
      await expect(efs.access(
          'testfile',
          (vfs.constants.W_OK |
           vfs.constants.X_OK)
        )).rejects.toThrow();
      await expect(efs.access(
          'dir',
          (vfs.constants.W_OK |
           vfs.constants.X_OK)
        )).rejects.toThrow();
    });
    test('--x-w-r-- permission staging', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile(`file`, 'hello');
      await efs.mkdir(`dir`);
      await efs.chmod(`file`, 0o111);
      await efs.chmod(`dir`, 0o111);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.access(`file`, vfs.constants.R_OK | vfs.constants.W_OK)).rejects.toThrow();
      await expect(efs.access(`dir`, vfs.constants.R_OK | vfs.constants.W_OK)).rejects.toThrow();
      await efs.access(`file`, vfs.constants.X_OK);
      await efs.access(`dir`, vfs.constants.X_OK);
    });

    test('file permissions ---', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile(`file`, 'hello');
      await efs.chmod(`file`, 0o000);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.access(`file`, vfs.constants.X_OK)).rejects.toThrow();
      await expect(efs.open(`file`, 'r')).rejects.toThrow();
      await expect(efs.open(`file`, 'w')).rejects.toThrow();
      const stat = await efs.stat(`file`) as vfs.Stat;
      expect(stat.isFile()).toStrictEqual(true);
    });

    test('file permissions r--', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'hello';
      await efs.writeFile(`file`, str);
      await efs.chmod(`file`, 0o444);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.access(`file`, vfs.constants.X_OK)).rejects.toThrow();
      await expect(efs.readFile(`file`, { encoding: 'utf8' })).resolves.toEqual(str);
      await expect(efs.open(`file`, 'w')).rejects.toThrow();
    });
    test('file permissions rw-', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile(`file`, 'world', { mode: 0o666 });
      await efs.chown('file', 1000, 1000);
      await efs.chmod(`file`, 0o666);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.access(`file`, vfs.constants.X_OK)).rejects.toThrow();
      const str = 'hello';
      await efs.writeFile(`file`, str);
      await expect(efs.readFile(`file`, { encoding: 'utf8' })).resolves.toEqual(str);
    });
    test('file permissions rwx', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile(`file`, 'world', { mode: 0o777 });
      await efs.chown('file', 1000, 1000);
      await efs.chmod(`file`, 0o777);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.access(`file`, vfs.constants.X_OK);
      const str = 'hello';
      await efs.writeFile(`file`, str);
      await expect(efs.readFile(`file`, { encoding: 'utf8' })).resolves.toEqual(str);
    });

    test('file permissions r-x', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'hello';
      await efs.writeFile(`file`, str);
      await efs.chmod(`file`, 0o500);
      await efs.access(`file`, vfs.constants.X_OK);
      await expect(efs.readFile(`file`, { encoding: 'utf8' })).resolves.toEqual(str);
    });
    test('file permissions -w-', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'hello';
      await efs.writeFile(`file`, str);
      await efs.chown('file', 1000, 1000);
      await efs.chmod(`file`, 0o222);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.access(`file`, vfs.constants.X_OK)).rejects.toThrow();
      await efs.writeFile(`file`, str);
      await expect(efs.open(`file`, 'r')).rejects.toThrow();
    });

    test('file permissions -wx', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'hello';
      await efs.writeFile(`file`, str);
      await efs.chown('file', 1000, 1000);
      await efs.chmod(`file`, 0o300);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.access(`file`, vfs.constants.X_OK);
      await efs.writeFile(`file`, str);
      await expect(efs.open(`file`, 'r')).rejects.toThrow();
    });
    test('file permissions --x', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.writeFile(`file`, 'hello');
      await efs.chown('file', 1000, 1000);
      await efs.chmod(`file`, 0o100);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.access(`file`, vfs.constants.X_OK);
      await expect(efs.open(`file`, 'w')).rejects.toThrow();
      await expect(efs.open(`file`, 'r')).rejects.toThrow();
    });
    test('directory permissions ---', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir(`---`);
      await efs.chown('---', 1000, 1000);
      await efs.chmod(`---`, 0o000);
      const stat = await efs.stat(`---`) as vfs.Stat;
      expect(stat.isDirectory()).toStrictEqual(true);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.writeFile(`---/a`, 'hello')).rejects.toThrow();
      await expect(efs.readdir(`---`)).rejects.toThrow();
    });

    test('directory permissions r--', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir(`r--`);
      await efs.writeFile(`r--/a`, 'hello');
      await efs.chmod(`r--`, 0o444);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.writeFile(`r--/b`, 'hello')).rejects.toThrow();
      await expect(efs.readdir(`r--`)).resolves.toContain('a');
      // you can always change metadata even without write permissions
      await efs.utimes(`r--`, new Date(), new Date());
    });
    test('directory permissions rw-', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir(`rw-`);
      await efs.writeFile(`rw-/a`, 'hello');
      await efs.chown('rw-', 1000, 1000);
      await efs.chown('rw-/a', 1000, 1000);
      await efs.chmod(`rw-`, 0o444);
      efs.uid = 1000;
      efs.gid = 1000;
      // you cannot write into a file
      await expect(efs.writeFile(`rw-/a`, 'world')).rejects.toThrow();
      // you cannot create a new file
      await expect(efs.writeFile(`rw-/b`, 'hello')).rejects.toThrow();
      // you cannot remove files
      await expect(efs.unlink(`rw-/a`)).rejects.toThrow();
      await expect(efs.readdir(`rw-`)).resolves.toContain('a');
      await efs.utimes(`rw-`, new Date(), new Date());
    });
    test('directory permissions rwx', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir(`rwx`);
      await efs.chown('rwx', 1000, 1000);
      await efs.chmod(`rwx`, 0o777);
      const str = 'abc';
      await efs.writeFile(`rwx/a`, str);
      await efs.chown('rwx/a', 1000, 1000);
      await efs.chmod('rwx/a', 0o777);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.readFile(`rwx/a`, { encoding: 'utf8' })).resolves.toEqual(str);
      await expect(efs.readdir(`rwx`)).resolves.toContain('a');
      const stat = await efs.stat(`rwx/a`) as vfs.Stat;
      expect(stat.isFile()).toStrictEqual(true);
    });
    test('directory permissions r-x', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir(`r-x`);
      await efs.chown('r-x', 1000, 1000);
      await efs.mkdir(`r-x/dir`);
      await efs.chown('r-x/dir', 1000, 1000);
      await efs.writeFile(`r-x/a`, 'hello');
      await efs.chown('r-x/a', 1000, 1000);
      await efs.chmod(`r-x`, 0o555);
      const str = 'world';
      efs.uid = 1000;
      efs.gid = 1000;
      // you can write to the file
      await efs.writeFile(`r-x/a`, str);
      // you cannot create new files
      await expect(efs.writeFile(`r-x/b`, str)).rejects.toThrow();
      // you can read the directory
      await expect(efs.readdir(`r-x`)).resolves.toContain('a');
      await expect(efs.readdir(`r-x`)).resolves.toContain('dir');
      // you can read the file
      await expect(efs.readFile(`r-x/a`, { encoding: 'utf8' })).resolves.toEqual(str);
      // you can traverse into the directory
      const stat = await efs.stat(`r-x/dir`) as vfs.Stat;
      expect(stat.isDirectory()).toStrictEqual(true);
      // you cannot delete the file
      await expect(efs.unlink(`r-x/a`)).rejects.toThrow();
      // cannot delete the directory
      await expect(efs.rmdir(`r-x/dir`)).rejects.toThrow();
    });
    test('directory permissions -w-', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir(`-w-`);
      await efs.chmod(`-w-`, 0o000);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.writeFile(`-w-/a`, 'hello')).rejects.toThrow();
      await expect(efs.readdir(`-w-`)).rejects.toThrow();
    });
    test('directory permissions -wx', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir(`-wx`);
      await efs.chmod(`-wx`, 0o333);
      const str = 'hello';
      await efs.writeFile(`-wx/a`, str);
      await efs.chmod(`-wx/a`, 0o777);
      await expect(efs.readFile(`-wx/a`, { encoding: 'utf8' })).resolves.toEqual(str);
      await efs.unlink(`-wx/a`);
      await efs.mkdir(`-wx/dir`);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.readdir(`-wx`)).rejects.toThrow();
      const stat = await efs.stat(`-wx/dir`) as vfs.Stat;
      expect(stat.isDirectory()).toStrictEqual(true);
    });
    test('directory permissions --x', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      await efs.mkdir(`--x`);
      const str = 'hello';
      await efs.writeFile(`--x/a`, str);
      await efs.chmod(`--x`, 0o111);
      efs.uid = 1000;
      efs.gid = 1000;
      await expect(efs.writeFile(`--x/b`, 'world')).rejects.toThrow();
      await expect(efs.unlink(`--x/a`)).rejects.toThrow();
      await expect(efs.readdir(`--x`)).rejects.toThrow();
      await expect(efs.readFile(`--x/a`, { encoding: 'utf8' })).resolves.toEqual(str);
    });
    test('permissions dont affect already opened fd', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'hello';
      await efs.writeFile(`file`, str);
      await efs.chmod(`file`, 0o777);
      const fd = await efs.open(`file`, 'r+');
      await efs.chmod(`file`, 0o000);
      await expect(efs.readFile(fd, { encoding: 'utf8' })).resolves.toEqual(str);
      await efs.close(fd);
    });
    test('chownr changes uid and gid recursively', async () => {
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
      await efs.writeFile('/dir/a', 'hello');
      await efs.writeFile('/dir/b', 'world');
      await efs.chownr('/dir', 1000, 2000);
      let stat = await efs.stat('/dir') as vfs.Stat;
      expect(stat.uid).toBe(1000);
      expect(stat.gid).toBe(2000);
      stat = await efs.stat('/dir/a') as vfs.Stat;
      expect(stat.uid).toBe(1000);
      expect(stat.gid).toBe(2000);
      stat = await efs.stat('/dir/b') as vfs.Stat;
      expect(stat.uid).toBe(1000);
      expect(stat.gid).toBe(2000);
      await efs.writeFile('/file', 'hello world');
      await efs.chownr('/file', 1000, 2000);
      stat = await efs.stat('/file') as vfs.Stat;
      expect(stat.uid).toBe(1000);
      expect(stat.gid).toBe(2000);
    });
  });
  describe('Streams', () => {
    test('readstream usage - \'for await\'', async () => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      await efs.writeFile(`/test`, str);
      const readable = await efs.createReadStream(`/test`, {
        encoding: 'utf8',
        start: 0,
        end: str.length - 1,
      });
      let readString = '';
      for await (const data of readable) {
        readString += data;
      }
      expect(readString).toBe(str);
    });
    test('readstream usage - \'event readable\'', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      await efs.writeFile(`/test`, str);
      const readable = await efs.createReadStream(`/test`, {
        encoding: 'utf8',
        start: 0,
        end: str.length - 1,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
            data += chunk;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str);
        done();
      });
    });
    test('readstream usage - \'event data\'', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      await efs.writeFile(`/test`, str);
      const readable = await efs.createReadStream(`/test`, {
        encoding: 'utf8',
        start: 0,
        end: str.length - 1,
      });
      let data = '';
      readable.on('data', (chunk) => {
        data += chunk;
      });
      readable.on('end', () => {
        expect(data).toBe(str);
        done();
      });
    });
    test('readstreams respect start and end options', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      await efs.writeFile(`file`, str, { encoding: 'utf8' });
      const readable = await efs.createReadStream(`file`, {
        encoding: 'utf8',
        start: 1,
        end: 3,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
            data += chunk;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str.slice(1,4));
        done();
      });
    });
    test('readstreams respect the high watermark', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      const highWatermark = 2;
      await efs.writeFile(`file`, str, { encoding: 'utf8' });
      const readable = await efs.createReadStream(`file`, {
        encoding: 'utf8',
        highWaterMark: highWatermark,
      });
      let chunk;
      let counter = 0;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
          expect(chunk).toBe(str.slice(counter, counter + highWatermark));
          data += chunk;
          counter += highWatermark;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str);
        done();
      });
    });
    test('readstream respects the start option', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      const filePath = `file`;
      const offset = 1;
      await efs.writeFile(filePath, str, { encoding: 'utf8' });
      const readable = await efs.createReadStream(filePath, {
        encoding: 'utf8',
        start: offset,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
            data += chunk;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str.slice(offset));
        done();
      });
    });
    test('readstream end option is ignored without the start option', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      const filePath = `file`;
      await efs.writeFile(filePath, str);
      const readable = await efs.createReadStream(filePath, {
        encoding: 'utf8',
        end: 1,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
            data += chunk;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str);
        done();
      });
    });
    test('readstream can use a file descriptor', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      const filePath = `file`;
      await efs.writeFile(filePath, str);
      const fd = await efs.open(filePath, 'r');
      const offset = 1;
      await efs.lseek(fd, offset);
      const readable = await efs.createReadStream('', {
        encoding: 'utf8',
        fd: fd,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
            data += chunk;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str.slice(offset));
        done();
      });
    });
    test('readstream with start option overrides the file descriptor position', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      await efs.writeFile(`file`, str);
      const fd = await efs.open(`file`, 'r');
      const offset = 1;
      const readable = await efs.createReadStream('', {
        encoding: 'utf8',
        fd: fd,
        start: offset,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
            data += chunk;
        }
      });
      readable.on('end', async () => {
        expect(data).toBe(str.slice(offset));
        const buf = Buffer.allocUnsafe(1);
        await efs.read(fd, buf, 0, buf.length);
        expect(buf.toString('utf8')).toBe(str.slice(0, buf.length));
        done();
      });
    });
    test('readstreams handle errors asynchronously', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const stream = await efs.createReadStream(`file`);
      stream.on('error', (err) => {
        expect(err instanceof Error).toBe(true);
        const error = err as any;
        expect(error.code).toBe('ENOENT');
        done();
      });
      stream.read(10);
    });
    // test('readstreams can compose with pipes', async (done) => {
    //   const efs = await EncryptedFS.createEncryptedFS({
    //     dbKey,
    //     dbPath,
    //     db,
    //     devMgr,
    //     iNodeMgr,
    //     umask: 0o022,
    //     logger,
    //   });
    //   const str = 'Hello';
    //   await efs.writeFile(`file`, str);
    //   const readStream = efs.createReadStream(`file`, {
    //     encoding: 'utf8',
    //     end: 10,
    //   });
    //   const b = new bl(function() { return Buffer.from('d')});
    //   b.read()
    //   (await efs.createReadStream('/file')).pipe((new bl([() => {}]) as unknown) as WriteStream);
    //   (await efs.createReadStream('/file')).pipe(bl((err, data) => {
    //     expect(data.toString('utf8')).toBe(str);
    //   }));
    // });
    test('writestream can create and truncate files', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      const fileName = `file`;
      const writable = await efs.createWriteStream(fileName, {})
      writable.end(str, async () => {
        const readStr = await efs.readFile(fileName, { encoding: 'utf-8' });
        console.log(readStr);
        expect(readStr).toEqual(str);
        const truncateWritable = await efs.createWriteStream(fileName, {});
        truncateWritable.end('', async () => {
          const readStr = await efs.readFile(fileName, { encoding: 'utf-8' });
          console.log(readStr);
          expect(readStr).toEqual('');
          done();
        });
      });
    });
    test('writestream can be written into', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const str = 'Hello';
      const stream = await efs.createWriteStream('file');
      stream.write(Buffer.from(str));
      stream.end();
      stream.on('finish', async () => {
        const readStr = await efs.readFile('file', { encoding: 'utf-8' });
        expect(readStr).toEqual(str);
        done();
      });
    });
    test('writestreams allow ignoring of the drain event, temporarily ignoring resource usage control', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const waterMark = 10;
      const writable = await efs.createWriteStream('file', { highWaterMark: waterMark });
      const buf = Buffer.allocUnsafe(waterMark).fill(97);
      const times = 4;
      for (let i = 0; i < times; ++i) {
        expect(writable.write(buf)).toBe(false);
      }
      writable.end(async () => {
        const readStr = await efs.readFile('file', { encoding: 'utf8' });
        expect(readStr).toBe(buf.toString().repeat(times));
        done();
      });
    });
    test('writestreams can use the drain event to manage resource control', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const waterMark = 10;
      const writable = await efs.createWriteStream('file', { highWaterMark: waterMark });
      const buf = Buffer.allocUnsafe(waterMark).fill(97);
      let times = 10;
      const timesOrig  = times;
      const writing = () => {
        let status;
        do {
          status = writable.write(buf);
          times -= 1;
          if (times === 0) {
            writable.end(async () => {
              const readStr = await efs.readFile('file', { encoding: 'utf8' });
              expect(readStr).toBe(buf.toString().repeat(timesOrig));
              done();
            });
          }
        } while (times > 0 && status);
        if (times > 0) {
          writable.once('drain', writing);
        }
      };
      writing();
    });
    test('writestreams handle errors asynchronously', async (done) => {
      const efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      const fileName = `file/unknown`;
      const writable = await efs.createWriteStream(fileName);
      // note that it is possible to have the finish event occur before the error event
      writable.once('error', (err) => {
        expect(err instanceof Error).toBe(true);
        const error = err as any;
        expect(error.code).toBe('ENOENT');
        done();
      });
      writable.end();
    });
  });

      // test('write then read - single block', async () => {
    //   const efs = await EncryptedFS.createEncryptedFS({
    //     dbKey,
    //     dbPath,
    //     db,
    //     devMgr,
    //     iNodeMgr,
    //     umask: 0o022,
    //     logger,
    //   });
    //   const fd = await efs.open(`test.txt`, 'w+');
    //   const writeBuffer = Buffer.from('Super confidential information');
    //   const bytesWritten = await efs.write(fd, writeBuffer);
    //   expect(bytesWritten).toEqual(writeBuffer.length);
    //   const readBuffer = Buffer.alloc(writeBuffer.length);
    //   const bytesRead = await efs.read(fd, readBuffer);
    //   expect(bytesRead).toEqual(bytesWritten);
    //   expect(writeBuffer).toStrictEqual(readBuffer);
    // });
    // test('write then read - multiple blocks', async () => {
    //   const efs = await EncryptedFS.createEncryptedFS({
    //     dbKey,
    //     dbPath,
    //     db,
    //     devMgr,
    //     iNodeMgr,
    //     umask: 0o022,
    //     logger,
    //   });
    //   const fd = await efs.open(`test.txt`, 'w+');
    //   const blockSize = 4096;
    //   // Write data
    //   const writeBuffer = await utils.getRandomBytes(blockSize * 3);
    //   const bytesWritten = await efs.write(fd, writeBuffer);
    //   expect(bytesWritten).toEqual(writeBuffer.length);
    //   // Read data back
    //   const readBuffer = Buffer.alloc(writeBuffer.length);
    //   const bytesRead = await efs.read(fd, readBuffer);
    //   expect(bytesRead).toEqual(bytesWritten);
    //   expect(writeBuffer).toStrictEqual(readBuffer);
    // });
    // test('write non-zero position - middle of start block - with text buffer', async () => {
    //   const efs = await EncryptedFS.createEncryptedFS({
    //     dbKey,
    //     dbPath,
    //     db,
    //     devMgr,
    //     iNodeMgr,
    //     umask: 0o022,
    //     logger,
    //   });
    //   const blockSize = 4096;
    //   // Define file descriptor
    //   const filename = `test_middle_text.txt`;
    //   const fd = await efs.open(filename, 'w+');
    //   // Write initial data
    //   const writeBuffer = Buffer.alloc(blockSize);
    //   writeBuffer.write('one two three four five six seven eight nine ten');
    //   await efs.write(fd, writeBuffer);
    //   // write data in the middle
    //   const middlePosition = 240;
    //   const middleText = ' Malcom in the middle ';
    //   const middleData = Buffer.from(middleText);
    //   await efs.write(fd, middleData, 0, middleData.length, middlePosition);
    //   // re-read the blocks
    //   const readBuffer = Buffer.alloc(blockSize);
    //   await efs.read(fd, readBuffer, 0, readBuffer.length, 0);
    //   middleData.copy(writeBuffer, middlePosition);
    //   const expected = writeBuffer;
    //   expect(expected).toStrictEqual(readBuffer);
    // });
    // test('write non-zero position - middle of start block', async () => {
    //   const efs = await EncryptedFS.createEncryptedFS({
    //     dbKey,
    //     dbPath,
    //     db,
    //     devMgr,
    //     iNodeMgr,
    //     umask: 0o022,
    //     logger,
    //   });
    //   const blockSize = 4096;
    //   // write a three block file
    //   const writeBuffer = await utils.getRandomBytes(blockSize * 3);
    //   const filename = `test_middle.txt`;
    //   const fd = await efs.open(filename, 'w+');
    //   await efs.write(fd, writeBuffer, 0, writeBuffer.length, 0);
    //   // write data in the middle
    //   const middlePosition = 2000;
    //   const middleText = 'Malcom in the';
    //   const middleData = Buffer.from(middleText);
    //   await efs.write(fd, middleData, 0, middleData.length, middlePosition);
    //   // re-read the blocks
    //   const readBuffer = Buffer.alloc(blockSize * 3);
    //   await efs.read(fd, readBuffer, 0, readBuffer.length, 0);
    //   middleData.copy(writeBuffer, middlePosition);
    //   const expected = writeBuffer;
    //   expect(expected).toStrictEqual(readBuffer);
    // });
    // test('write non-zero position - middle of middle block', async () => {
    //   const efs = await EncryptedFS.createEncryptedFS({
    //     dbKey,
    //     dbPath,
    //     db,
    //     devMgr,
    //     iNodeMgr,
    //     umask: 0o022,
    //     logger,
    //   });
    //   const blockSize = 4096;
    //   // write a three block file
    //   const writeBuffer = await utils.getRandomBytes(blockSize * 3);
    //   const filename = `test_middle.txt`;
    //   let fd = await efs.open(filename, 'w+');
    //   await efs.write(fd, writeBuffer, 0, writeBuffer.length, 0);
    //   // write data in the middle
    //   const middlePosition = blockSize + 2000;
    //   const middleData = Buffer.from('Malcom in the');
    //   await efs.write(fd, middleData, 0, middleData.length, middlePosition);
    //   // re-read the blocks
    //   const readBuffer = Buffer.alloc(blockSize * 3);
    //   fd = await efs.open(filename, 'r+');
    //   await efs.read(fd, readBuffer, 0, readBuffer.length, 0);
    //   middleData.copy(writeBuffer, middlePosition);
    //   const expected = writeBuffer;
    //   expect(readBuffer).toEqual(expected);
    // });

    // test('write non-zero position - middle of end block', async () => {
    //   const efs = await EncryptedFS.createEncryptedFS({
    //     dbKey,
    //     dbPath,
    //     db,
    //     devMgr,
    //     iNodeMgr,
    //     umask: 0o022,
    //     logger,
    //   });
    //   const blockSize = 4096;
    //   // write a three block file
    //   const writePos = 2 * blockSize + 2000;
    //   const writeBuffer = await utils.getRandomBytes(blockSize * 3);
    //   const fd = await efs.open(`test_middle.txt`, 'w+');
    //   await efs.write(fd, writeBuffer, 0, writeBuffer.length, 0);
    //   // write data in the middle
    //   const middleData = Buffer.from('Malcom in the');
    //   await efs.write(fd, middleData, 0, middleData.length, writePos);
    //   // re-read the blocks
    //   const readBuffer = Buffer.alloc(blockSize * 3);
    //   await efs.read(fd, readBuffer, 0, readBuffer.length, 0);
    //   middleData.copy(writeBuffer, writePos);
    //   const expected = writeBuffer;
    //   expect(readBuffer).toEqual(expected);
    // });
    // test('write segment spanning across two block', async () => {
    //   const efs = await EncryptedFS.createEncryptedFS({
    //     dbKey,
    //     dbPath,
    //     db,
    //     devMgr,
    //     iNodeMgr,
    //     umask: 0o022,
    //     logger,
    //   });
    //   const blockSize = 4096;
    //   // write a three block file
    //   const writeBuffer = await utils.getRandomBytes(blockSize * 3);
    //   const fd = await efs.open(`test_middle.txt`, 'w+');
    //   await efs.write(fd, writeBuffer, 0, writeBuffer.length, 0);
    //   // write data in the middle
    //   const writePos = 4090;
    //   const middleData = Buffer.from('Malcom in the');
    //   await efs.write(fd, middleData, 0, middleData.length, writePos);
    //   // re-read the blocks
    //   const readBuffer = Buffer.alloc(blockSize * 3);
    //   await efs.read(fd, readBuffer, 0, readBuffer.length, 0);
    //   middleData.copy(writeBuffer, writePos);
    //   const expected = writeBuffer;
    //   expect(readBuffer).toEqual(expected);
    // });

// ////////////////////////
// // Bisimulation tests //
// ////////////////////////
// describe('bisimulation with nodejs fs tests', () => {
//   let efsdataDir: string;
//   let fsdataDir: string;
//   beforeEach(() => {
//     efsdataDir = `efsTesting`;
//     fsdataDir = `${dataDir}/fsTesting`;
//   });

//   describe('one set of read/write operations', () => {
//     describe('one set of read/write operations - 1 block', () => {
//       test('one set of read/write operations - 1 block - full block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |<---------->|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer);
//         const efsFirstReadBuffer = Buffer.alloc(blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer);
//         const fsFirstReadBuffer = Buffer.alloc(blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('one set of read/write operations - 1 block - left block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |<-------->--|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           0,
//           3000,
//           0,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           0,
//           3000,
//           0,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('one set of read/write operations - 1 block - right block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |--<-------->|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           1000,
//           3096,
//           1000,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(blockSize);
//         efs.readSync(efsFd, efsFirstReadBuffer, 1000, 3096, 1000);

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           1000,
//           3096,
//           1000,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 1000, 3096, 1000);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('one set of read/write operations - 1 block - not block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |--<------>--|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           1000,
//           2000,
//           1000,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(blockSize);
//         efs.readSync(efsFd, efsFirstReadBuffer, 1000, 2000, 1000);

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           1000,
//           2000,
//           1000,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 1000, 2000, 1000);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });
//     });
//     describe('one set of read/write operations - 2 block', () => {
//       test('one set of read/write operations - 2 block - full block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |<---------->|<---------->|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer);
//         const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer);
//         const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('one set of read/write operations - 2 block - left block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |<---------->|<-------->--|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           0,
//           6000,
//           0,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           0,
//           6000,
//           0,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('one set of read/write operations - 2 block - right block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |--<-------->|<---------->|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           1000,
//           2 * blockSize - 1000,
//           1000,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           1000,
//           2 * blockSize - 1000,
//           1000,
//         );

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           1000,
//           2 * blockSize - 1000,
//           1000,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         fs.readSync(
//           fsFd,
//           fsFirstReadBuffer,
//           1000,
//           2 * blockSize - 1000,
//           1000,
//         );

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('one set of read/write operations - 2 block - not block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |--<-------->|<-------->--|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           1000,
//           6000,
//           1000,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         efs.readSync(efsFd, efsFirstReadBuffer, 1000, 6000, 1000);

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           1000,
//           6000,
//           1000,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 1000, 6000, 1000);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });
//     });
//     describe('one set of read/write operations - 3 block', () => {
//       test('one set of read/write operations - 3 block - full block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |<---------->|<---------->|<---------->|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer);
//         const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer);
//         const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//       });

//       test('one set of read/write operations - 3 block - left block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |<---------->|<---------->|<-------->--|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           0,
//           2 * blockSize + 1000,
//           0,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           0,
//           2 * blockSize + 1000,
//           0,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('one set of read/write operations - 3 block - right block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |--<-------->|<---------->|<---------->|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           1000,
//           3 * blockSize - 1000,
//           1000,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           1000,
//           3 * blockSize - 1000,
//           1000,
//         );

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           1000,
//           3 * blockSize - 1000,
//           1000,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         fs.readSync(
//           fsFd,
//           fsFirstReadBuffer,
//           1000,
//           3 * blockSize - 1000,
//           1000,
//         );

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('one set of read/write operations - 3 block - not block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // case: |--<-------->|<---------->|<-------->--|
//         const blockSize = 4096;
//         const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         const efsFd = efs.openSync(efsFilename, 'w+');
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           1000,
//           2 * blockSize + 1000,
//           1000,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           1000,
//           2 * blockSize + 1000,
//           1000,
//         );

//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         const fsFd = fs.openSync(fsFilename, 'w+');
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           1000,
//           2 * blockSize + 1000,
//           1000,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         fs.readSync(
//           fsFd,
//           fsFirstReadBuffer,
//           1000,
//           2 * blockSize + 1000,
//           1000,
//         );

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });
//     });
//   });

//   describe('read/write operations on existing 3 block file', () => {
//     let efsFd: number;
//     let fsFd: number;
//     const blockSize = 20;
//     // Write 3 block file
//     // case: |<---------->|<---------->|<---------->|
//     const WriteBuffer = crypto.randomBytes(3 * blockSize);

//     describe('read/write operations on existing 3 block file - one set of read/write operations - 1 block', () => {
//       test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - full block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |<---------->|<==========>|<==========>|
//         const firstWriteBuffer = crypto.randomBytes(blockSize);
//         const offset = 0;
//         const length = blockSize;
//         const position = 0;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - left block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |<-------->==|<==========>|<==========>|
//         const firstWriteBuffer = crypto.randomBytes(blockSize);
//         const offset = 0;
//         const length = Math.ceil(blockSize * 0.8);
//         const position = 0;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - right block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |==<-------->|<==========>|<==========>|
//         const firstWriteBuffer = crypto.randomBytes(blockSize);
//         const offset = Math.ceil(blockSize * 0.2);
//         const length = blockSize - offset;
//         const position = offset;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(blockSize);
//         efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - not block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |==<------>==|<==========>|<==========>|
//         const firstWriteBuffer = crypto.randomBytes(blockSize);
//         const offset = Math.ceil(blockSize * 0.2);
//         const length = Math.ceil(blockSize * 0.6);
//         const position = offset;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(blockSize);
//         efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });
//     });
//     describe('read/write operations on existing 3 block file - one set of read/write operations - 2 block', () => {
//       test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - full block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |<---------->|<---------->|<==========>|
//         const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
//         const offset = 0;
//         const length = 2 * blockSize;
//         const position = offset;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - left block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |<---------->|<-------->==|<==========>|
//         const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
//         const offset = 0;
//         const length = blockSize + Math.ceil(blockSize * 0.8);
//         const position = 0;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           offset,
//           efsFirstReadBuffer.length,
//           position,
//         );

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         fs.readSync(
//           fsFd,
//           fsFirstReadBuffer,
//           offset,
//           fsFirstReadBuffer.length,
//           position,
//         );

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - right block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |==<-------->|<---------->|<==========>|
//         const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
//         const offset = Math.ceil(blockSize * 0.2);
//         const length = 2 * blockSize - offset;
//         const position = offset;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - not block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |==<-------->|<-------->==|<==========>|
//         const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
//         const offset = Math.ceil(blockSize * 0.2);
//         const length = 2 * (blockSize - offset);
//         const position = offset;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });
//     });
//     describe('read/write operations on existing 3 block file - one set of read/write operations - 3 block', () => {
//       test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - full block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |<---------->|<---------->|<---------->|
//         const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
//         const offset = 0;
//         const length = 3 * blockSize;
//         const position = offset;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - left block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |<---------->|<---------->|<-------->==|
//         const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
//         const offset = 0;
//         const length = 3 * blockSize - Math.ceil(blockSize * 0.2);
//         const position = offset;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         efs.readSync(
//           efsFd,
//           efsFirstReadBuffer,
//           0,
//           efsFirstReadBuffer.length,
//           0,
//         );

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - right block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |==<-------->|<---------->|<---------->|
//         const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
//         const offset = Math.ceil(blockSize * 0.2);
//         const length = 3 * blockSize - offset;
//         const position = offset;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });

//       test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - not block aligned', () => {
//         const efs = new EncryptedFS(key, fs, dataDir);
//         efs.mkdirSync(efsdataDir);
//         fs.mkdirSync(fsdataDir);
//         // efs
//         const efsFilename = `${efsdataDir}/file`;
//         efsFd = efs.openSync(efsFilename, 'w+');
//         efs.writeSync(efsFd, WriteBuffer);
//         // fs
//         const fsFilename = `${fsdataDir}/file`;
//         fsFd = fs.openSync(fsFilename, 'w+');
//         fs.writeSync(fsFd, WriteBuffer);
//         // case: |==<-------->|<---------->|<-------->==|
//         const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
//         const offset = Math.ceil(blockSize * 0.2);
//         const length = 3 * blockSize - 2 * offset;
//         const position = offset;
//         // efs
//         const efsFirstBytesWritten = efs.writeSync(
//           efsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

//         // fs
//         const fsFirstBytesWritten = fs.writeSync(
//           fsFd,
//           firstWriteBuffer,
//           offset,
//           length,
//           position,
//         );
//         const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
//         fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

//         // Comparison
//         expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
//         expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//         efs.rmdirSync(efsdataDir, { recursive: true });
//         fs.mkdirSync(fsdataDir, { recursive: true });
//       });
//     });
//   });

//   describe('readFile/writeFile operations', () => {
//     const blockSize = 4096;

//     test('readFile/writeFile operations - under block size', () => {
//       const efs = new EncryptedFS(key, fs, dataDir);
//       efs.mkdirSync(efsdataDir);
//       fs.mkdirSync(fsdataDir);
//       const firstWriteBuffer = crypto.randomBytes(
//         Math.ceil(blockSize * Math.random()),
//       );
//       // efs
//       const efsFilename = `${efsdataDir}/file`;
//       efs.writeFileSync(efsFilename, firstWriteBuffer);
//       const efsFirstReadBuffer = efs.readFileSync(efsFilename);

//       // fs
//       const fsFilename = `${fsdataDir}/file`;
//       fs.writeFileSync(fsFilename, firstWriteBuffer);
//       const fsFirstReadBuffer = fs.readFileSync(fsFilename);

//       // Comparison
//       expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//       efs.rmdirSync(efsdataDir, { recursive: true });
//       fs.mkdirSync(fsdataDir, { recursive: true });
//     });

//     test('readFile/writeFile operations - over block size', () => {
//       const efs = new EncryptedFS(key, fs, dataDir);
//       efs.mkdirSync(efsdataDir);
//       fs.mkdirSync(fsdataDir);
//       const firstWriteBuffer = crypto.randomBytes(
//         Math.ceil(blockSize + blockSize * Math.random()),
//       );
//       // efs
//       const efsFilename = `${efsdataDir}/file`;
//       efs.writeFileSync(efsFilename, firstWriteBuffer);
//       const efsFirstReadBuffer = efs.readFileSync(efsFilename);

//       // fs
//       const fsFilename = `${fsdataDir}/file`;
//       fs.writeFileSync(fsFilename, firstWriteBuffer);
//       const fsFirstReadBuffer = fs.readFileSync(fsFilename);

//       // Comparison
//       expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
//       efs.rmdirSync(efsdataDir, { recursive: true });
//       fs.mkdirSync(fsdataDir, { recursive: true });
//     });
//   });
// });

// describe('aynchronous worker tests', () => {
//   test('encryption and decryption using workers - read/write', async () => {
//     const efs = new EncryptedFS(key, fs, dataDir);
//     const workerManager = new WorkerManager({ logger });
//     await workerManager.start();
//     const plainBuf = Buffer.from('very important secret');
//     const deciphered = Buffer.from(plainBuf).fill(0);
//     const fd = efs.openSync('test', 'w+');
//     efs.setWorkerManager(workerManager);
//     await utils.promisify(efs.write.bind(efs))(
//       fd,
//       plainBuf,
//       0,
//       plainBuf.length,
//       0,
//     );
//     await utils.promisify(efs.read.bind(efs))(
//       fd,
//       deciphered,
//       0,
//       deciphered.length,
//       0,
//     );
//     expect(deciphered).toStrictEqual(plainBuf);
//     efs.unsetWorkerManager();
//     await workerManager.stop();
//   });

//   test('encryption and decryption using workers', async () => {
//     const efs = new EncryptedFS(key, fs, dataDir);
//     const workerManager = new WorkerManager({ logger });
//     await workerManager.start();
//     const plainBuf = Buffer.from('very important secret');
//     efs.setWorkerManager(workerManager);
//     await utils.promisify(efs.writeFile.bind(efs))(`test`, plainBuf, {});
//     const deciphered = await utils.promisify(efs.readFile.bind(efs))(
//       `test`,
//       {},
//     );
//     expect(deciphered).toStrictEqual(plainBuf);
//     efs.unsetWorkerManager();
//     await workerManager.stop();
//   });

//   test('encryption and decryption using workers for encryption but not decryption', async () => {
//     const efs = new EncryptedFS(key, fs, dataDir);
//     const workerManager = new WorkerManager({ logger });
//     await workerManager.start();
//     const plainBuf = Buffer.from('very important secret');
//     efs.setWorkerManager(workerManager);
//     await utils.promisify(efs.writeFile.bind(efs))('test', plainBuf, {});
//     efs.unsetWorkerManager();
//     await workerManager.stop();
//     const deciphered = await utils.promisify(efs.readFile.bind(efs))(
//       `test`,
//       {},
//     );
//     expect(deciphered).toStrictEqual(plainBuf);
//   });

//   test('encryption and decryption using workers for decryption but not encryption', async () => {
//     const efs = new EncryptedFS(key, fs, dataDir);
//     const workerManager = new WorkerManager({ logger });
//     await workerManager.start();
//     const plainBuf = Buffer.from('very important secret');
//     await utils.promisify(efs.writeFile.bind(efs))('test', plainBuf, {});
//     efs.setWorkerManager(workerManager);
//     const deciphered = await utils.promisify(efs.readFile.bind(efs))(
//       `test`,
//       {},
//     );
//     expect(deciphered).toStrictEqual(plainBuf);
//     efs.unsetWorkerManager();
//     await workerManager.stop();
//   });
// });

// describe('vfs chache', () => {
//   test('read file cache', () => {
//     const efs = new EncryptedFS(key, fs, dataDir);
//     const buffer = Buffer.from('Hello World', 'utf8');
//     efs.writeFileSync(`hello-world`, buffer);
//     expect(efs.readFileSync(`hello-world`, {})).toEqual(buffer);
//     const efs2 = new EncryptedFS(key, fs, dataDir);
//     expect(efs2.readFileSync(`hello-world`, {})).toEqual(buffer);
//   });
//   test('read cache', () => {
//     const efs = new EncryptedFS(key, fs, dataDir);
//     const buffer = Buffer.from('Hello World', 'utf8');
//     efs.writeFileSync(`hello-world`, buffer);
//     expect(efs.readFileSync(`hello-world`, {})).toEqual(buffer);
//     const efs2 = new EncryptedFS(key, fs, dataDir);
//     expect(efs2.readFileSync(`hello-world`, {})).toEqual(buffer);
//   });
//   test('block cache using block mapping', () => {
//     const efs = new EncryptedFS(key, fs, dataDir);
//     const buffer = Buffer.from('Hello World', 'utf8');
//     const bufferRead = Buffer.from(buffer).fill(0);
//     const fd = efs.openSync('hello-world', 'w+');
//     efs.writeSync(fd, buffer, 0, buffer.length, 5000);
//     efs.closeSync(fd);
//     const fd2 = efs.openSync('hello-world', 'r+');
//     efs.readSync(fd2, bufferRead, 0, buffer.length, 5000);
//     expect(bufferRead).toEqual(buffer);
//     efs.closeSync(fd2);
//   });
//   test('block cache not using block mapping', () => {
//     const efs = new EncryptedFS(key, fs, dataDir);
//     const buffer = Buffer.from('Hello World', 'utf8');
//     const bufferRead = Buffer.from(buffer).fill(0);
//     const fd = efs.openSync('hello-world', 'w+');
//     efs.writeSync(fd, buffer, 0, buffer.length, 5000);
//     efs.closeSync(fd);
//     const efs2 = new EncryptedFS(key, fs, dataDir);
//     const fd2 = efs2.openSync('hello-world', 'r+');
//     efs2.readSync(fd2, bufferRead, 0, buffer.length, 5000);
//     expect(bufferRead).toEqual(buffer);
//     efs2.closeSync(fd2);
//   });
//   test('access rights are retreived from cache', () => {
//     const efs = new EncryptedFS(key, fs, dataDir);
//     const buffer = Buffer.from('Hello World', 'utf8');
//     efs.writeFileSync('hello-world', buffer);
//     efs.setuid(1000);
//     efs.setgid(1000);
//     efs.accessSync('hello-world', efs.constants.R_OK);
//     efs.setuid(0);
//     efs.setgid(0);
//     efs.chmodSync('hello-world', 0o333);
//     const efs2 = new EncryptedFS(key, fs, dataDir);
//     efs2.setuid(1000);
//     efs2.setgid(1000);
//     expect(() => {
//       efs2.accessSync('hello-world', efs2.constants.R_OK);
//     }).toThrow();
//   });
// });
// });














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
