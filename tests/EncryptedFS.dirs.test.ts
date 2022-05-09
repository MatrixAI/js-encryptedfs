import type { FileTypes } from './utils';
import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import path from 'path';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import { code as errno } from 'errno';
import EncryptedFS from '@/EncryptedFS';
import { ErrorEncryptedFSError } from '@/errors';
import * as utils from '@/utils';
import * as constants from '@/constants';
import { expectError, createFile, setId, sleep } from './utils';

describe(`${EncryptedFS.name} Directories`, () => {
  const logger = new Logger(`${EncryptedFS.name} Directories`, LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let dbPath: string;
  const dbKey: Buffer = utils.generateKeySync(256);
  let efs: EncryptedFS;
  const n0 = 'zero';
  const n1 = 'one';
  const n2 = 'two';
  const n3 = 'three';
  const n4 = 'four';
  const dp = 0o0755;
  const tuid = 0o65534;
  const supportedTypes: FileTypes[] = ['regular', 'dir', 'block', 'symlink'];
  let types: FileTypes[];
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      pathNode.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    dbPath = `${dataDir}/db`;
    efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      umask: 0o022,
      logger,
    });
  });
  afterEach(async () => {
    await efs.stop();
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test('directory stat makes sense', async () => {
    await efs.mkdir('dir');
    const stat = await efs.stat(`dir`);
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(true);
    expect(stat.isSocket()).toStrictEqual(false);
    expect(stat.isSymbolicLink()).toStrictEqual(false);
    expect(stat.isFIFO()).toStrictEqual(false);
  });
  test('empty root directory at startup', async () => {
    await expect(efs.readdir('/')).resolves.toEqual([]);
    const stat = await efs.stat('/');
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(true);
    expect(stat.isSymbolicLink()).toStrictEqual(false);
  });
  describe('file descriptors', () => {
    test('can change stats, permissions and flush data', async () => {
      const dirName = `dir`;
      await efs.mkdir(dirName);
      const dirfd = await efs.open(dirName, 'r');
      await efs.fsync(dirfd);
      await efs.fdatasync(dirfd);
      await efs.fchmod(dirfd, 0o666);
      await efs.fchown(dirfd, 0, 0);
      const date = new Date();
      await efs.futimes(dirfd, date, date);
      const stats = await efs.fstat(dirfd);
      expect(stats.atime.toJSON()).toEqual(date.toJSON());
      expect(stats.mtime.toJSON()).toEqual(date.toJSON());
      await efs.close(dirfd);
    });
    test('cannot perform read or write operations', async () => {
      const dirName = `dir`;
      await efs.mkdir(dirName);
      // Opening it without O_RDONLY would result in EISDIR
      const dirfd = await efs.open(
        dirName,
        constants.O_RDONLY | constants.O_DIRECTORY,
      );
      const buffer = Buffer.alloc(10);
      await expectError(
        efs.ftruncate(dirfd),
        ErrorEncryptedFSError,
        errno.EINVAL,
      );
      await expectError(
        efs.read(dirfd, buffer, 0, 10),
        ErrorEncryptedFSError,
        errno.EISDIR,
      );
      await expectError(
        efs.write(dirfd, buffer),
        ErrorEncryptedFSError,
        errno.EBADF,
      );
      await expectError(
        efs.readFile(dirfd),
        ErrorEncryptedFSError,
        errno.EISDIR,
      );
      await expectError(
        efs.writeFile(dirfd, `test`),
        ErrorEncryptedFSError,
        errno.EBADF,
      );
      await efs.close(dirfd);
    });
    test('inode nlink becomes 0 after deletion of the directory', async () => {
      await efs.mkdir('/dir');
      const fd = await efs.open('/dir', 'r');
      await efs.rmdir('/dir');
      const stat = await efs.fstat(fd);
      expect(stat.nlink).toBe(1);
      await efs.close(fd);
    });
  });
  describe('rmdir', () => {
    test('should be able to remove directories', async () => {
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
      await expectError(
        efs.access('first'),
        ErrorEncryptedFSError,
        errno.ENOENT,
      );
      await expectError(
        efs.readdir('first'),
        ErrorEncryptedFSError,
        errno.ENOENT,
      );
      const rootlist = await efs.readdir('.');
      expect(rootlist).toEqual(['backslash\\dir']);
    });
    test('cannot delete current directory using .', async () => {
      await efs.mkdir('/removed');
      await efs.chdir('/removed');
      await expectError(efs.rmdir('.'), ErrorEncryptedFSError, errno.EINVAL);
    });
    test('cannot delete parent directory using .. even when current directory is deleted', async () => {
      await efs.mkdir('/removeda/removedb', { recursive: true });
      await efs.chdir('/removeda/removedb');
      await efs.rmdir('../removedb');
      await efs.rmdir('../../removeda');
      await expectError(efs.rmdir('..'), ErrorEncryptedFSError, errno.EINVAL);
    });
    test('cannot create inodes within a deleted current directory', async () => {
      await efs.writeFile('/dummy', 'hello');
      await efs.mkdir('/removed');
      await efs.chdir('/removed');
      await efs.rmdir('../removed');
      await expectError(
        efs.writeFile('./a', 'abc'),
        ErrorEncryptedFSError,
        errno.ENOENT,
      );
      await expectError(efs.mkdir('./b'), ErrorEncryptedFSError, errno.ENOENT);
      await expectError(
        efs.symlink('../dummy', 'c'),
        ErrorEncryptedFSError,
        errno.ENOENT,
      );
      await expectError(
        efs.link('../dummy', 'd'),
        ErrorEncryptedFSError,
        errno.ENOENT,
      );
    });
    test('returns ENOENT if the named directory does not exist (04)', async () => {
      await efs.mkdir(n0, 0o0755);
      await efs.rmdir(n0);
      await expectError(efs.rmdir(n0), ErrorEncryptedFSError, errno.ENOENT);
      await expectError(efs.rmdir(n1), ErrorEncryptedFSError, errno.ENOENT);
    });
    test('returns ELOOP if too many symbolic links were encountered in translating the pathname', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(
        efs.rmdir(path.join(n0, 'test')),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await expectError(
        efs.rmdir(path.join(n1, 'test')),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await efs.unlink(n0);
      await efs.unlink(n1);
    });
    test.each(supportedTypes)(
      "returns ENOTEMPTY if the named directory contains files other than '.' and '..' in it for %s",
      async (type) => {
        await efs.mkdir(n0, 0o0755);
        await createFile(efs, type as FileTypes, path.join(n0, n1));
        await expectError(
          efs.rmdir(n0),
          ErrorEncryptedFSError,
          errno.ENOTEMPTY,
        );
      },
    );
    test('returns EACCES when search permission is denied for a component of the path prefix', async () => {
      await efs.mkdir(n0, 0o0755);
      await efs.mkdir(path.join(n0, n1), 0o0755);
      await efs.chown(path.join(n0, n1), 0o65534, 0o65534);
      await efs.mkdir(path.join(n0, n1, n2), 0o0755);
      await efs.chown(path.join(n0, n1, n2), 0o65534, 0o65534);
      await efs.chmod(path.join(n0, n1), 0o0644);
      efs.gid = 0o65534;
      efs.uid = 0o65534;
      await expectError(
        efs.rmdir(path.join(n0, n1, n2)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
    });
    test('returns EACCES when write permission is denied on the directory containing the link to be removed', async () => {
      await efs.mkdir(n0, { mode: 0o0755 });
      await efs.mkdir(path.join(n0, n1), { mode: 0o0755 });
      await efs.chown(path.join(n0, n1), 0o65534, 0o65534);
      await efs.mkdir(path.join(n0, n1, n2), { mode: 0o0755 });
      await efs.chown(path.join(n0, n1, n2), 0o65534, 0o65534);
      await efs.chmod(path.join(n0, n1), 0o0555);
      efs.gid = 0o65543;
      efs.uid = 0o65543;
      await expectError(
        efs.rmdir(path.join(n0, n1, n2)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
    });
    test.each(supportedTypes)(
      'recursively deletes the directory if it contains %s',
      async (type) => {
        await efs.mkdir(n0, { mode: 0o0755 });
        await createFile(efs, type as FileTypes, path.join(n0, n1));
        await efs.rmdir(n0, { recursive: true });
        await expect(efs.readdir('.')).resolves.toEqual([]);
      },
    );
    test('recursively deletes a deep directory', async () => {
      await efs.mkdir(n0, { mode: 0o0755 });
      await efs.mkdir(path.join(n0, n1), { mode: 0o0755 });
      await efs.mkdir(path.join(n0, n1, n2), { mode: 0o0755 });
      await efs.writeFile(path.join(n0, n2), 'test');
      await efs.writeFile(path.join(n0, n0), 'test');
      await efs.writeFile(path.join(n0, n1, n1), 'test');
      await efs.writeFile(path.join(n0, n1, n0), 'test');
      await efs.writeFile(path.join(n0, n1, n2, n0), 'test');
      await efs.writeFile(path.join(n0, n1, n2, n1), 'test');
      await efs.writeFile(path.join(n0, n1, n2, n2), 'test');
      await efs.rmdir(n0, { recursive: true });
      await expect(efs.readdir('.')).resolves.toEqual([]);
    });
    // Recursive deleting
    const MODE_RX = 0o555; // R-xr-xr-x
    const MODE_RW = 0o655; // Rw-r-xr-x
    test('to fail recursive delete when the parent directory lacks the write permission', async () => {
      await efs.chown('.', 1000, 1000);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.mkdir(n0, { mode: 0o0755 });
      await efs.mkdir(path.join(n0, n1), { mode: 0o0755 });
      await efs.mkdir(path.join(n0, n1, n2), { mode: 0o0755 });
      await efs.writeFile(path.join(n0, n2), 'test');
      await efs.writeFile(path.join(n0, n0), 'test');
      await efs.writeFile(path.join(n0, n1, n1), 'test');
      await efs.writeFile(path.join(n0, n1, n0), 'test');
      await efs.writeFile(path.join(n0, n1, n2, n0), 'test');
      await efs.writeFile(path.join(n0, n1, n2, n1), 'test');
      await efs.writeFile(path.join(n0, n1, n2, n2), 'test');
      // Removing write permissions from directory n0
      await efs.chmod(n0, MODE_RX);
      // Expectation is that direct n0, n0/n1 has no permissions
      await expectError(
        efs.rmdir(n0, { recursive: true }),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await expectError(
        efs.rmdir(path.join(n0, n1), { recursive: true }),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      // But n0/n1/n2 and deeper still has permission to be removed
      await expect(
        efs.rmdir(path.join(n0, n1, n2), { recursive: true }),
      ).resolves.toBeUndefined();
    });
    test('to fail recursive delete when the parent directory lacks the search permission', async () => {
      await efs.chown('.', 1000, 1000);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.mkdir(n0, { mode: 0o0755 });
      await efs.mkdir(path.join(n0, n1), { mode: 0o0755 });
      await efs.mkdir(path.join(n0, n1, n2), { mode: 0o0755 });
      await efs.writeFile(path.join(n0, n2), 'test');
      await efs.writeFile(path.join(n0, n0), 'test');
      await efs.writeFile(path.join(n0, n1, n1), 'test');
      await efs.writeFile(path.join(n0, n1, n0), 'test');
      await efs.writeFile(path.join(n0, n1, n2, n0), 'test');
      await efs.writeFile(path.join(n0, n1, n2, n1), 'test');
      await efs.writeFile(path.join(n0, n1, n2, n2), 'test');
      // Removing search permissions from directory n0
      await efs.chmod(n0, MODE_RW);
      // Expectation is that direct n0, n0/n1 and n0/n1/n2 has no permissions
      await expectError(
        efs.rmdir(n0, { recursive: true }),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await expectError(
        efs.rmdir(path.join(n0, n1), { recursive: true }),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await expectError(
        efs.rmdir(path.join(n0, n1, n2), { recursive: true }),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
    });
    test('to recursively delete when the target directory lacks write permission and is empty', async () => {
      await efs.chown('.', 1000, 1000);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.mkdir(n0, { mode: 0o0755 });
      // Removing write permissions from directory n0
      await efs.chmod(n0, MODE_RX);
      // Expectation is that direct n0 can be removed when empty
      await expect(efs.rmdir(n0, { recursive: true })).resolves.toBeUndefined();
    });
    test('to fail recursive delete when the target directory lacks write permission and is not empty', async () => {
      await efs.chown('.', 1000, 1000);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.mkdir(n0, { mode: 0o0755 });
      await efs.writeFile(path.join(n0, n2), 'test');
      await efs.writeFile(path.join(n0, n0), 'test');
      // Removing write permissions from directory n0
      await efs.chmod(n0, MODE_RX);
      // Expectation is that directory n0 lacks permissions
      await expectError(
        efs.rmdir(n0, { recursive: true }),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
    });
    test('to recursively delete when the target directory lacks search permissions and is empty', async () => {
      await efs.chown('.', 1000, 1000);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.mkdir(n0, { mode: 0o0755 });
      // Removing search permissions from directory n0
      await efs.chmod(n0, MODE_RW);
      // Expectation is that direct n0 can be removed when empty
      await expect(efs.rmdir(n0, { recursive: true })).resolves.toBeUndefined();
    });
    test('to fail recursive delete when the target directory lacks search permissions and is not empty', async () => {
      await efs.chown('.', 1000, 1000);
      efs.uid = 1000;
      efs.gid = 1000;
      await efs.mkdir(n0, { mode: 0o0755 });
      await efs.writeFile(path.join(n0, n2), 'test');
      await efs.writeFile(path.join(n0, n0), 'test');
      // Removing write permissions from directory n0
      await efs.chmod(n0, MODE_RW);
      // Expectation is that direct n0, n0/n1 has no permissions
      await expectError(
        efs.rmdir(n0, { recursive: true }),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
    });
  });
  describe('mkdir & mkdtemp', () => {
    test('is able to make directories', async () => {
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
      await efs.mkdir(`a/depth/sub/dir`, { recursive: true });
      await expect(efs.exists(`a/depth/sub`)).resolves.toBe(true);
      const stat = await efs.stat(`a/depth/sub`);
      expect(stat.isFile()).toStrictEqual(false);
      expect(stat.isDirectory()).toStrictEqual(true);
    });
    test('can create temporary directories', async () => {
      const tempSubDir = `dir`;
      const temp = await efs.mkdtemp(tempSubDir);
      const buffer = Buffer.from('abc');
      await efs.writeFile(`${temp}/test`, buffer);
      await expect(
        efs.readFile(`${temp}/test`, { encoding: 'utf8' }),
      ).resolves.toEqual(buffer.toString());
    });
    test('should not make the root directory', async () => {
      await expectError(efs.mkdir('/'), ErrorEncryptedFSError, errno.EEXIST);
    });
    test("trailing '/.' should not result in any errors", async () => {
      await expect(
        efs.mkdir('one/two', { recursive: true }),
      ).resolves.not.toThrow();
      await expect(
        efs.mkdir('three/four', { recursive: true }),
      ).resolves.not.toThrow();
      await expect(
        efs.mkdir('five/six/.', { recursive: true }),
      ).resolves.not.toThrow();
    });
    test('returns EACCES when write permission is denied on the parent directory of the directory to be created', async () => {
      await efs.mkdir(n1, { mode: dp });
      await efs.chown(n1, tuid, tuid);
      setId(efs, tuid);
      await efs.mkdir(path.join(n1, n2), { mode: dp });
      await efs.rmdir(path.join(n1, n2));
      await efs.chmod(n1, 0o0555);
      await expectError(
        efs.mkdir(path.join(n1, n2)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await efs.chmod(n1, dp);
      await efs.mkdir(path.join(n1, n2), { mode: dp });
    });
    test.each(supportedTypes)(
      'returns EEXIST if the named %s exists',
      async (type) => {
        await efs.mkdir('test');
        await createFile(efs, type, n0);
        await expectError(
          efs.mkdir(n0, { mode: dp }),
          ErrorEncryptedFSError,
          errno.EEXIST,
        );
      },
    );
  });
  describe('rename', () => {
    test('can rename a directory', async () => {
      await efs.mkdir('/test');
      await expect(efs.readdir('.')).resolves.toEqual(['test']);
      await efs.rename('/test', '/test-rename');
      await expect(efs.readdir('.')).resolves.toEqual(['test-rename']);
    });
    test('cannot rename the current or parent directory to a subdirectory', async () => {
      await efs.mkdir('/cwd');
      await efs.chdir('/cwd');
      await expectError(
        efs.rename('.', 'subdir'),
        ErrorEncryptedFSError,
        errno.EBUSY,
      );
      await efs.mkdir('/cwd/cwd');
      await efs.chdir('/cwd/cwd');
      await expectError(
        efs.rename('..', 'subdir'),
        ErrorEncryptedFSError,
        errno.EBUSY,
      );
    });
    test('cannot rename where the old path is a strict prefix of the new path', async () => {
      await efs.mkdir('/cwd1/cwd2', { recursive: true });
      await efs.chdir('/cwd1/cwd2');
      await expectError(
        efs.rename('../cwd2', 'subdir'),
        ErrorEncryptedFSError,
        errno.EINVAL,
      );
      await efs.mkdir('/cwd1/cwd2/cwd3');
      await expectError(
        efs.rename('./cwd3', './cwd3/cwd4'),
        ErrorEncryptedFSError,
        errno.EINVAL,
      );
    });
    types = ['regular', 'block'];
    test.each(types)(
      'changes name but inode remains the same for %s',
      async (type) => {
        await createFile(efs, type as FileTypes, n0, 0o0644);
        const inode = (await efs.lstat(n0)).ino;
        await efs.rename(n0, n1);
        await expectError(efs.lstat(n0), ErrorEncryptedFSError, errno.ENOENT);
        let stat = await efs.lstat(n1);
        expect(stat.ino).toEqual(inode);
        // Expect(stat.mode).toEqual(0o0644);
        expect(stat.nlink).toEqual(1);
        await efs.link(n1, n0);
        stat = await efs.lstat(n0);
        expect(stat.ino).toEqual(inode);
        // Expect(stat.mode).toEqual(0o0644);
        expect(stat.nlink).toEqual(2);
        stat = await efs.lstat(n1);
        expect(stat.ino).toEqual(inode);
        // Expect(stat.mode).toEqual(0o0644);
        expect(stat.nlink).toEqual(2);
        await efs.rename(n1, n2);
        stat = await efs.lstat(n0);
        expect(stat.ino).toEqual(inode);
        // Expect(stat.mode).toEqual(0o0644);
        expect(stat.nlink).toEqual(2);
        await expectError(efs.lstat(n1), ErrorEncryptedFSError, errno.ENOENT);
        stat = await efs.lstat(n2);
        expect(stat.ino).toEqual(inode);
        // Expect(stat.mode).toEqual(0o0644);
        expect(stat.nlink).toEqual(2);
      },
    );
    test('changes name for dir', async () => {
      await efs.mkdir(n0, { mode: dp });
      // Expect dir,0755 lstat ${n0} type,mode
      const inode = (await efs.lstat(n0)).ino;
      await efs.rename(n0, n1);
      await expectError(efs.lstat(n0), ErrorEncryptedFSError, errno.ENOENT);
      const stat = await efs.lstat(n1);
      expect(stat.ino).toEqual(inode);
      // Expect(stat.mode).toEqual(0o0755);
    });
    test('changes name for regular file', async () => {
      await createFile(efs, 'regular', n0);
      const rinode = (await efs.lstat(n0)).ino;
      // Expect regular,0644 lstat ${n0} type,mode
      await efs.symlink(n0, n1);
      const sinode = (await efs.lstat(n1)).ino;
      let stat = await efs.stat(n1);
      expect(stat.ino).toEqual(rinode);
      stat = await efs.lstat(n1);
      expect(stat.ino).toEqual(sinode);
      await efs.rename(n1, n2);
      stat = await efs.lstat(n0);
      expect(stat.ino).toEqual(rinode);
      await expectError(efs.lstat(n1), ErrorEncryptedFSError, errno.ENOENT);
      stat = await efs.lstat(n2);
      expect(stat.ino).toEqual(sinode);
    });
    test.each(supportedTypes)(
      'unsuccessful of %s does not update ctime',
      async (type) => {
        await createFile(efs, type, n0);
        const ctime1 = (await efs.lstat(n0)).ctime;
        await sleep(10);
        setId(efs, tuid);
        await expectError(
          efs.rename(n0, n1),
          ErrorEncryptedFSError,
          errno.EACCES,
        );
        const ctime2 = (await efs.lstat(n0)).ctime;
        expect(ctime1).toEqual(ctime2);
      },
    );
    test("returns ENOENT if a component of the 'from' path does not exist, or a path prefix of 'to' does not exist", async () => {
      await efs.mkdir(n0, { mode: dp });
      await expectError(
        efs.rename(path.join(n0, n1, 'test'), n2),
        ErrorEncryptedFSError,
        errno.ENOENT,
      );
      await createFile(efs, 'regular', n2);
      await expectError(
        efs.rename(n2, path.join(n0, n1, 'test')),
        ErrorEncryptedFSError,
        errno.ENOENT,
      );
    });
    test('returns EACCES when a component of either path prefix denies search permission', async () => {
      await efs.mkdir(n1, { mode: dp });
      await efs.chown(n1, tuid, tuid);
      await efs.mkdir(n2, { mode: dp });
      await efs.chown(n2, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', path.join(n1, n3));

      await efs.rename(path.join(n1, n3), path.join(n2, n4));
      await efs.rename(path.join(n2, n4), path.join(n1, n3));

      await efs.chmod(n1, 0o0644);
      await expectError(
        efs.rename(path.join(n1, n3), path.join(n1, n4)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await expectError(
        efs.rename(path.join(n1, n3), path.join(n2, n4)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );

      await efs.chmod(n1, 0o0755);
      await efs.chmod(n2, 0o0644);
      await expectError(
        efs.rename(path.join(n1, n3), path.join(n2, n4)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
    });
    test('returns EACCES when the requested link requires writing in a directory with a mode that denies write permission', async () => {
      await efs.mkdir(n1, { mode: dp });
      await efs.chown(n1, tuid, tuid);
      await efs.mkdir(n2, { mode: dp });
      await efs.chown(n2, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', path.join(n1, n3));

      await efs.rename(path.join(n1, n3), path.join(n2, n4));
      await efs.rename(path.join(n2, n4), path.join(n1, n3));

      await efs.chmod(n2, 0o0555);
      await expectError(
        efs.rename(path.join(n1, n3), path.join(n2, n4)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await efs.chmod(n1, 0o0555);
      await expectError(
        efs.rename(path.join(n1, n3), path.join(n1, n4)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
    });
    test('returns ELOOP if too many symbolic links were encountered in translating one of the pathnames', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(
        efs.rename(path.join(n0, 'test'), n2),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await expectError(
        efs.rename(path.join(n0, 'test'), n1),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await createFile(efs, 'regular', n2);
      await expectError(
        efs.rename(n2, path.join(n0, 'test')),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await expectError(
        efs.rename(n2, path.join(n1, 'test')),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
    });
    types = ['regular', 'block'];
    test.each(types)(
      'returns ENOTDIR if a component of either path prefix is a %s',
      async (type) => {
        await efs.mkdir(n0, { mode: dp });
        await createFile(efs, type as FileTypes, path.join(n0, n1));
        await expectError(
          efs.rename(path.join(n0, n1, 'test'), path.join(n0, n2)),
          ErrorEncryptedFSError,
          errno.ENOTDIR,
        );
        await createFile(efs, type as FileTypes, path.join(n0, n2));
        await expectError(
          efs.rename(path.join(n0, n2), path.join(n0, n1, 'test')),
          ErrorEncryptedFSError,
          errno.ENOTDIR,
        );
      },
    );
    types = ['regular', 'block', 'symlink'];
    test.each(types)(
      "returns ENOTDIR when the 'from' argument is a directory, but 'to' is a %s",
      async (type) => {
        await efs.mkdir(n0, { mode: dp });
        await createFile(efs, type as FileTypes, n1);
        await expectError(
          efs.rename(n0, n1),
          ErrorEncryptedFSError,
          errno.ENOTDIR,
        );
      },
    );
    test.each(types)(
      "returns EISDIR when the 'to' argument is a directory, but 'from' is a %s",
      async (type) => {
        await efs.mkdir(n0, { mode: dp });
        await createFile(efs, type as FileTypes, n1);
        await expectError(
          efs.rename(n1, n0),
          ErrorEncryptedFSError,
          errno.EISDIR,
        );
      },
    );
    test("returns EINVAL when the 'from' argument is a parent directory of 'to'", async () => {
      await efs.mkdir(n0, { mode: dp });
      await efs.mkdir(path.join(n0, n1), { mode: dp });

      await expectError(
        efs.rename(n0, path.join(n0, n1)),
        ErrorEncryptedFSError,
        errno.EINVAL,
      );
      await expectError(
        efs.rename(n0, path.join(n0, n1, n2)),
        ErrorEncryptedFSError,
        errno.EINVAL,
      );
    });
    test.each(supportedTypes)(
      "returns ENOTEMPTY if the 'to' argument is a directory and contains %s",
      async (type) => {
        await efs.mkdir(n0, { mode: dp });
        await efs.mkdir(n1, { mode: dp });
        await createFile(efs, type, path.join(n1, n2));
        await expectError(
          efs.rename(n0, n1),
          ErrorEncryptedFSError,
          errno.ENOTEMPTY,
        );
      },
    );
    test.each(supportedTypes)('changes file ctime for %s', async (type) => {
      const src = n0;
      const dst = n1;
      await createFile(efs, type, src);
      const ctime1 = (await efs.lstat(src)).ctime.getTime();
      await sleep(10);
      await efs.rename(src, dst);
      const ctime2 = (await efs.lstat(dst)).ctime.getTime();
      expect(ctime1).toBeLessThan(ctime2);
    });
    types = ['regular', 'block'];
    test.each(types)(
      'succeeds when destination %s is multiply linked',
      async (type) => {
        const src = n0;
        const dst = n1;
        const dstlnk = n2;
        await createFile(efs, type as FileTypes, src);
        await createFile(efs, type as FileTypes, dst);
        await efs.link(dst, dstlnk);
        const ctime1 = (await efs.lstat(dstlnk)).ctime.getTime();
        await sleep(10);
        await efs.rename(src, dst);
        // Destination inode should have reduced nlink and updated ctime
        expect((await efs.lstat(dstlnk)).nlink).toEqual(1);
        const ctime2 = (await efs.lstat(dstlnk)).ctime.getTime();
        expect(ctime1).toBeLessThan(ctime2);
      },
    );
  });
});
