import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import * as vfs from 'virtualfs';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import * as utils from '@/utils';
import EncryptedFS from '@/EncryptedFS';
import { errno } from '@/EncryptedFSError';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import {
  expectError,
  createFile,
  FileTypes,
  setId,
  supportedTypes,
  sleep,
} from './utils';
import path from 'path';

describe('EncryptedFS Directories', () => {
  const logger = new Logger('EncryptedFS Directories', LogLevel.WARN, [
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
    await efs.mkdirp(tempSubDir);
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
    await expectError(efs.rmdir('.'), errno.EINVAL);
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
    await expectError(efs.rmdir('..'), errno.EINVAL);
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
    await expectError(efs.rename('.', 'subdir'), errno.EBUSY);
    await efs.mkdir('/cwd/cwd');
    await efs.chdir('/cwd/cwd');
    await expectError(efs.rename('..', 'subdir'), errno.EBUSY);
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
    await expectError(efs.rename('../cwd2', 'subdir'), errno.EINVAL);
    await efs.mkdir('/cwd1/cwd2/cwd3');
    await expectError(efs.rename('./cwd3', './cwd3/cwd4'), errno.EINVAL);
  });
  test('trailing /. for mkdirp should not result in any errors', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    await expect(efs.mkdirp('one/two')).resolves.not.toThrow();
    await expect(efs.mkdirp('three/four')).resolves.not.toThrow();
    await expect(efs.mkdirp('five/six/.')).resolves.not.toThrow();
  });
  describe('rmdir', () => {
    let efs: EncryptedFS;
    let n0: string;
    let n1: string;
    let n2: string;
    const supportedTypes = ['regular', 'dir', 'block', 'char', 'symlink'];
    beforeEach(async () => {
      efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      n0 = 'zero';
      n1 = 'one';
      n2 = 'two';
    });
    test('returns ENOENT if the named directory does not exist (04)', async () => {
      await efs.mkdir(n0, 0o0755);
      await efs.rmdir(n0);
      await expectError(efs.rmdir(n0), errno.ENOENT);
      await expectError(efs.rmdir(n1), errno.ENOENT);
    });
    test('returns ELOOP if too many symbolic links were encountered in translating the pathname (05)', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(efs.rmdir(path.join(n0, 'test')), errno.ELOOP);
      await expectError(efs.rmdir(path.join(n1, 'test')), errno.ELOOP);
      await efs.unlink(n0);
      await efs.unlink(n1);
    });
    describe("returns ENOTEMPTY if the named directory contains files other than '.' and '..' in it (06)", () => {
      beforeEach(async () => {
        await efs.mkdir(n0, 0o0755);
      });
      test.each(supportedTypes)('for %s', async (type) => {
        await createFile(efs, type as FileTypes, path.join(n0, n1));
        await expectError(efs.rmdir(n0), errno.ENOTEMPTY);
      });
    });
    test('returns EACCES when search permission is denied for a component of the path prefix (07)', async () => {
      await efs.mkdir(n0, 0o0755);
      await efs.mkdir(path.join(n0, n1), 0o0755);
      await efs.chown(path.join(n0, n1), 0o65534, 0o65534);
      await efs.mkdir(path.join(n0, n1, n2), 0o0755);
      await efs.chown(path.join(n0, n1, n2), 0o65534, 0o65534);
      await efs.chmod(path.join(n0, n1), 0o0644);
      efs.gid = 0o65534;
      efs.uid = 0o65534;
      await expectError(efs.rmdir(path.join(n0, n1, n2)), errno.EACCES);
    });
    test('returns EACCES when write permission is denied on the directory containing the link to be removed (08)', async () => {
      await efs.mkdir(n0, 0o0755);
      await efs.mkdir(path.join(n0, n1), 0o0755);
      await efs.chown(path.join(n0, n1), 0o65534, 0o65534);
      await efs.mkdir(path.join(n0, n1, n2), 0o0755);
      await efs.chown(path.join(n0, n1, n2), 0o65534, 0o65534);
      await efs.chmod(path.join(n0, n1), 0o0555);
      efs.gid = 0o65543;
      efs.uid = 0o65543;
      await expectError(efs.rmdir(path.join(n0, n1, n2)), errno.EACCES);
    });
    test.skip('returns EACCES or EPERM if the directory containing the directory to be removed is marked sticky, and neither the containing directory nor the directory to be removed are owned by the effective user ID (11)', async () => {
      const dp = 0o0755;
      const dg = 0o65534;
      await efs.mkdir(n2, dp);

      await efs.mkdir(path.join(n2, n0), dp);
      await efs.chown(path.join(n2, n0), dg, dg);
      await efs.chmod(path.join(n2, n0), 0o01777);

      //User owns both: the sticky directory and the directory to be removed.
      await efs.mkdir(path.join(n2, n0, n1), dp);
      await efs.chown(path.join(n2, n0, n1), dg, dg);
      const stat = await efs.lstat(path.join(n2, n0, n1));
      expect(stat.gid).toEqual(dg);
      expect(stat.uid).toEqual(dg);
      await efs.rmdir(path.join(n2, n0, n1));
      await expectError(efs.lstat(path.join(n2, n0, n1)), errno.ENOENT);

      // User owns the directory to be removed, but doesn't own the sticky directory.
      for (let id = 0; id < 0o65533; id += 0o1000) {
        //spot checking IDs
        const PUT = path.join(n2, n0, n1);
        await efs.chown(path.join(n2, n0), id, id);
        await createFile(efs, 'dir', PUT, dg, dg);
        const stat = await efs.lstat(PUT);
        expect(stat.gid).toEqual(dg);
        expect(stat.uid).toEqual(dg);
        await efs.rmdir(PUT);
        await expectError(efs.lstat(PUT), errno.ENOENT);
      }

      // User owns the sticky directory, but doesn't own the directory to be removed.
      for (let id = 0; id < 0o65533; id += 0o1000) {
        //spot checking IDs
        const PUT = path.join(n2, n0, n1);
        await createFile(efs, 'dir', PUT, id, id);
        const stat = await efs.lstat(PUT);
        expect(stat.gid).toEqual(id);
        expect(stat.uid).toEqual(id);
        await efs.rmdir(PUT);
        await expectError(efs.lstat(PUT), errno.ENOENT);
      }

      // User doesn't own the sticky directory nor the directory to be removed.
      for (let id = 0; id < 0o65533; id += 0o1000) {
        //spot checking IDs
        const PUT = path.join(n2, n0, n1);
        await efs.chown(path.join(n2, n0), id, id);
        await createFile(efs, 'dir', PUT, id, id);
        const stat = await efs.lstat(PUT);
        expect(stat.gid).toEqual(id);
        expect(stat.uid).toEqual(id);
        efs.gid = dg;
        efs.uid = dg;
        await expectError(efs.rmdir(PUT), errno.EACCES);
        const stat2 = await efs.lstat(PUT);
        expect(stat2.gid).toEqual(id);
        expect(stat2.uid).toEqual(id);
        await efs.rmdir(PUT);
      }
    });
  });
  describe('mkdir', () => {
    let efs: EncryptedFS;
    let n0: string;
    let n1: string;
    let n2: string;

    const dp = 0o0755;
    const tuid = 0o65534;
    beforeEach(async () => {
      efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      n0 = 'zero';
      n1 = 'one';
      n2 = 'two';
    });

    test('returns EACCES when write permission is denied on the parent directory of the directory to be created (06)', async () => {
      await efs.mkdir(n1, dp);
      await efs.chown(n1, tuid, tuid);
      setId(efs, tuid);
      await efs.mkdir(path.join(n1, n2), dp);
      await efs.rmdir(path.join(n1, n2));
      await efs.chmod(n1, 0o0555);
      await expectError(efs.mkdir(path.join(n1, n2)), errno.EACCES);
      await efs.chmod(n1, dp);
      await efs.mkdir(path.join(n1, n2), dp);
    });
    describe('returns EEXIST if the named file exists (10)', () => {
      test.each(supportedTypes)('Type: %s', async (type) => {
        await efs.mkdir('test');
        await createFile(efs, type, n0);
        await expectError(efs.mkdir(n0, dp), errno.EEXIST);
      });
    });
  });
  describe('rename', () => {
    let efs: EncryptedFS;
    let n0: string;
    let n1: string;
    let n2: string;
    let n3: string;
    let n4: string;

    const dp = 0o0755;
    const tuid = 0o65534;
    beforeEach(async () => {
      efs = await EncryptedFS.createEncryptedFS({
        dbKey,
        dbPath,
        db,
        devMgr,
        iNodeMgr,
        umask: 0o022,
        logger,
      });
      n0 = 'zero';
      n1 = 'one';
      n2 = 'two';
      n3 = 'three';
      n4 = 'four';
    });

    describe(' changes file name (00)', () => {
      describe('inode remains the same.', function () {
        const types = ['regular', 'block', 'char'];
        test.each(types)('for %s', async (type) => {
          await createFile(efs, type as FileTypes, n0, 0o0644);
          const inode = (await efs.lstat(n0)).ino;
          await efs.rename(n0, n1);
          await expectError(efs.lstat(n0), errno.ENOENT);
          let stat = await efs.lstat(n1);
          expect(stat.ino).toEqual(inode);
          // expect(stat.mode).toEqual(0o0644);
          expect(stat.nlink).toEqual(1);
          await efs.link(n1, n0);
          stat = await efs.lstat(n0);
          expect(stat.ino).toEqual(inode);
          // expect(stat.mode).toEqual(0o0644);
          expect(stat.nlink).toEqual(2);
          stat = await efs.lstat(n1);
          expect(stat.ino).toEqual(inode);
          // expect(stat.mode).toEqual(0o0644);
          expect(stat.nlink).toEqual(2);
          await efs.rename(n1, n2);
          stat = await efs.lstat(n0);
          expect(stat.ino).toEqual(inode);
          // expect(stat.mode).toEqual(0o0644);
          expect(stat.nlink).toEqual(2);
          await expectError(efs.lstat(n1), errno.ENOENT);
          stat = await efs.lstat(n2);
          expect(stat.ino).toEqual(inode);
          // expect(stat.mode).toEqual(0o0644);
          expect(stat.nlink).toEqual(2);
        });
      });
      test('for dir', async () => {
        await efs.mkdir(n0, dp);
        //expect dir,0755 lstat ${n0} type,mode
        const inode = (await efs.lstat(n0)).ino;
        await efs.rename(n0, n1);
        await expectError(efs.lstat(n0), errno.ENOENT);
        const stat = await efs.lstat(n1);
        expect(stat.ino).toEqual(inode);
        // expect(stat.mode).toEqual(0o0755);
      });
      test('for regular file', async () => {
        await createFile(efs, 'regular', n0);
        const rinode = (await efs.lstat(n0)).ino;
        //expect regular,0644 lstat ${n0} type,mode
        await efs.symlink(n0, n1);
        const sinode = (await efs.lstat(n1)).ino;
        let stat = await efs.lstat(n1);
        expect(stat.ino).toEqual(rinode);
        stat = await efs.lstat(n1);
        expect(stat.ino).toEqual(sinode);
        await efs.rename(n1, n2);
        stat = await efs.lstat(n0);
        expect(stat.ino).toEqual(rinode);
        await expectError(efs.lstat(n1), errno.ENOENT);
        stat = await efs.lstat(n2);
        expect(stat.ino).toEqual(sinode);
      });
      describe('unsuccessful link(2) does not update ctime.', () => {
        test.each(supportedTypes)('for %s', async (type) => {
          await createFile(efs, type, n0);
          const ctime1 = (await efs.lstat(n0)).ctime;
          await sleep(10);
          setId(efs, tuid);
          await expectError(efs.rename(n0, n1), errno.EACCES);
          const ctime2 = (await efs.lstat(n0)).ctime;
          expect(ctime1).toEqual(ctime2);
        });
      });
    });
    test("returns ENOENT if a component of the 'from' path does not exist, or a path prefix of 'to' does not exist (03)", async () => {
      await efs.mkdir(n0, dp);
      await expectError(
        efs.rename(path.join(n0, n1, 'test'), n2),
        errno.ENOENT,
      );
      await createFile(efs, 'regular', n2);
      await expectError(
        efs.rename(n2, path.join(n0, n1, 'test')),
        errno.ENOENT,
      );
    });
    test('returns EACCES when a component of either path prefix denies search permission (04)', async () => {
      await efs.mkdir(n1, dp);
      await efs.chown(n1, tuid, tuid);
      await efs.mkdir(n2, dp);
      await efs.chown(n2, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', path.join(n1, n3));

      await efs.rename(path.join(n1, n3), path.join(n2, n4));
      await efs.rename(path.join(n2, n4), path.join(n1, n3));

      await efs.chmod(n1, 0o0644);
      await expectError(
        efs.rename(path.join(n1, n3), path.join(n1, n4)),
        errno.EACCES,
      );
      await expectError(
        efs.rename(path.join(n1, n3), path.join(n2, n4)),
        errno.EACCES,
      );

      await efs.chmod(n1, 0o0755);
      await efs.chmod(n2, 0o0644);
      await expectError(
        efs.rename(path.join(n1, n3), path.join(n2, n4)),
        errno.EACCES,
      );
    });
    test('returns EACCES when the requested link requires writing in a directory with a mode that denies write permission (05)', async () => {
      await efs.mkdir(n1, dp);
      await efs.chown(n1, tuid, tuid);
      await efs.mkdir(n2, dp);
      await efs.chown(n2, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', path.join(n1, n3));

      await efs.rename(path.join(n1, n3), path.join(n2, n4));
      await efs.rename(path.join(n2, n4), path.join(n1, n3));

      await efs.chmod(n2, 0o0555);
      await expectError(
        efs.rename(path.join(n1, n3), path.join(n2, n4)),
        errno.EACCES,
      );
      await efs.chmod(n1, 0o0555);
      await expectError(
        efs.rename(path.join(n1, n3), path.join(n1, n4)),
        errno.EACCES,
      );
    });
    describe("returns EACCES or EPERM if the directory containing 'from' is marked sticky, and neither the containing directory nor 'from' are owned by the effective user ID (09)", () => {
      beforeEach(async () => {
        await efs.mkdir(n0, dp);
        await efs.chmod(n0, 0o01777);
        await efs.chown(n0, tuid, tuid);

        await efs.mkdir(n1, dp);
        await efs.chown(n1, tuid, tuid);
      });
      const types = ['regular', 'block', 'char', 'symlink'];
      describe.each(types)('for type A of %s', (mainType) => {
        let inode;

        describe('User owns both: the source sticky directory and the source file.', () => {
          beforeEach(async () => {
            await efs.chown(n0, tuid, tuid);
            await createFile(
              efs,
              mainType as FileTypes,
              path.join(n0, n2),
              tuid,
              tuid,
            );
            inode = (await efs.lstat(path.join(n0, n2))).ino;
          });
          test.each(['none', ...types])('for %s', async (type) => {
            await createFile(
              efs,
              type as FileTypes,
              path.join(n1, n3),
              tuid,
              tuid,
            );
            setId(efs, tuid);
            await efs.rename(path.join(n0, n2), path.join(n1, n3));
            await expectError(efs.lstat(path.join(n0, n2)), errno.ENOENT);
            let stat = await efs.lstat(path.join(n1, n3));
            expect(stat.ino).toEqual(inode);
            expect(stat.uid).toEqual(tuid);
            expect(stat.gid).toEqual(tuid);
            await efs.rename(path.join(n1, n3), path.join(n0, n2));
            stat = await efs.lstat(path.join(n0, n2));
            expect(stat.ino).toEqual(inode);
            await expectError(efs.lstat(path.join(n1, n3)), errno.ENOENT);
          });
        });
        test("User owns the source sticky directory, but doesn't own the source file.", async () => {
          for (let id = 1; id < 65533; id += 10000) {
            //Spot checking Ids
            efs.uid = 0;
            efs.gid = 0;
            await efs.chown(n0, tuid, tuid);
            await createFile(
              efs,
              mainType as FileTypes,
              path.join(n0, n2),
              id,
              id,
            );
            const inode = (await efs.lstat(path.join(n0, n2))).ino;

            for (const type of ['none', ...types]) {
              setId(efs, tuid);
              await createFile(
                efs,
                type as FileTypes,
                path.join(n1, n3),
                tuid,
                tuid,
              );
              await efs.rename(path.join(n0, n2), path.join(n1, n3));
              await expectError(efs.lstat(path.join(n0, n2)), errno.ENOENT);
              let stat = await efs.lstat(path.join(n1, n3));
              expect(stat.ino).toEqual(inode);
              expect(stat.uid).toEqual(id);
              expect(stat.gid).toEqual(id);
              await efs.rename(path.join(n1, n3), path.join(n0, n2));
              stat = await efs.lstat(path.join(n0, n2));
              expect(stat.ino).toEqual(inode);
              await expectError(efs.lstat(path.join(n1, n3)), errno.ENOENT);
            }

            await efs.unlink(path.join(n0, n2));
          }
        });
        test("User owns the source file, but doesn't own the source sticky directory.", async () => {
          for (let id = 1; id < 65533; id += 10000) {
            //Spot checking Ids
            efs.uid = 0;
            efs.gid = 0;
            await efs.chown(n0, id, id);
            await createFile(
              efs,
              mainType as FileTypes,
              path.join(n0, n2),
              tuid,
              tuid,
            );
            const inode = (await efs.lstat(path.join(n0, n2))).ino;

            for (const type of ['none', ...types]) {
              setId(efs, tuid);
              await createFile(
                efs,
                type as FileTypes,
                path.join(n1, n3),
                tuid,
                tuid,
              );
              await efs.rename(path.join(n0, n2), path.join(n1, n3));
              await expectError(efs.lstat(path.join(n0, n2)), errno.ENOENT);
              let stat = await efs.lstat(path.join(n1, n3));
              expect(stat.ino).toEqual(inode);
              expect(stat.uid).toEqual(tuid);
              expect(stat.gid).toEqual(tuid);
              await efs.rename(path.join(n1, n3), path.join(n0, n2));
              stat = await efs.lstat(path.join(n0, n2));
              expect(stat.ino).toEqual(inode);
              await expectError(efs.lstat(path.join(n1, n3)), errno.ENOENT);
            }

            await efs.unlink(path.join(n0, n2));
          }
        });
        test("User doesn't own the source sticky directory nor the source file.", async () => {
          for (let id = 1; id < 65533; id += 10000) {
            //Spot checking Ids
            efs.uid = 0;
            efs.gid = 0;
            await efs.chown(n0, id, id);
            await createFile(
              efs,
              mainType as FileTypes,
              path.join(n0, n2),
              id,
              id,
            );
            await efs.chown(path.join(n0, n2), id, id);
            const inode = (await efs.lstat(path.join(n0, n2))).ino;

            for (const type of ['none', ...types]) {
              setId(efs, tuid);
              await createFile(
                efs,
                type as FileTypes,
                path.join(n1, n3),
                tuid,
                tuid,
              );
              await expectError(
                efs.rename(path.join(n0, n2), path.join(n1, n3)),
                errno.EACCES,
              );
              let stat = await efs.lstat(path.join(n0, n2));
              expect(stat.ino).toEqual(inode);
              expect(stat.uid).toEqual(id);
              expect(stat.gid).toEqual(id);

              stat = await efs.lstat(path.join(n1, n3));
              expect(stat.ino).toEqual(inode);
              expect(stat.uid).toEqual(tuid);
              expect(stat.gid).toEqual(tuid);
              await efs.unlink(path.join(n1, n3));
            }

            await efs.unlink(path.join(n0, n2));
          }
        });
      });

      test('User owns both: the source sticky directory and the source directory.', async () => {
        await efs.chown(n0, tuid, tuid);
        await createFile(efs, 'dir', path.join(n0, n2), tuid, tuid);
        const inode = (await efs.lstat(path.join(n0, n2))).ino;

        setId(efs, tuid);
        await efs.rename(path.join(n0, n2), path.join(n1, n3));
        await expectError(efs.lstat(path.join(n0, n2)), errno.ENOENT);
        let stat = await efs.lstat(path.join(n1, n3));
        expect(stat.ino).toEqual(inode);
        expect(stat.uid).toEqual(tuid);
        expect(stat.gid).toEqual(tuid);
        await efs.rename(path.join(n1, n3), path.join(n0, n2));

        await efs.mkdir(path.join(n1, n3), dp);
        await efs.rename(path.join(n0, n2), path.join(n1, n3));
        await expectError(efs.lstat(path.join(n0, n2)), errno.ENOENT);
        stat = await efs.lstat(path.join(n1, n3));
        expect(stat.ino).toEqual(inode);
        expect(stat.uid).toEqual(tuid);
        expect(stat.gid).toEqual(tuid);
      });
      test("User owns the source sticky directory, but doesn't own the source file fails when changing parent directory.", async () => {
        for (let id = 0; id < 65533; id += 10000) {
          await efs.chown(n0, tuid, tuid);
          await createFile(efs, 'dir', path.join(n0, n2), id, id);
          const inode = (await efs.lstat(path.join(n0, n2))).ino;

          setId(efs, tuid);
          await expectError(
            efs.rename(path.join(n0, n2), path.join(n1, n3)),
            errno.EACCES,
          );
          let stat = await efs.lstat(path.join(n0, n2));
          expect(stat.ino).toEqual(inode);
          expect(stat.uid).toEqual(id);
          expect(stat.gid).toEqual(id);

          await efs.rename(path.join(n0, n2), path.join(n0, n3));
          await expectError(efs.lstat(path.join(n0, n2)), errno.ENOENT);
          stat = await efs.lstat(path.join(n0, n3));
          expect(stat.ino).toEqual(inode);
          expect(stat.uid).toEqual(id);
          expect(stat.gid).toEqual(id);
          await efs.rename(path.join(n0, n3), path.join(n0, n2));

          await efs.mkdir(path.join(n1, n3), dp);
          await expectError(
            efs.rename(path.join(n0, n2), path.join(n1, n3)),
            errno.EACCES,
          );
          stat = await efs.lstat(path.join(n0, n2));
          expect(stat.ino).toEqual(inode);
          expect(stat.uid).toEqual(id);
          expect(stat.gid).toEqual(id);
          await efs.rmdir(path.join(n1, n3));

          await efs.mkdir(path.join(n0, n3), dp);
          await efs.rename(path.join(n0, n2), path.join(n0, n3));
          await expectError(efs.lstat(path.join(n0, n2)), errno.EACCES);
          stat = await efs.lstat(path.join(n0, n2));
          expect(stat.ino).toEqual(inode);
          expect(stat.uid).toEqual(id);
          expect(stat.gid).toEqual(id);
          await efs.rmdir(path.join(n0, n3));
        }
      });
      test("User owns the source directory, but doesn't own the source sticky directory.", async () => {
        for (let id = 0; id < 65533; id += 10000) {
          setId(efs, 0);
          await efs.chown(n0, id, id);
          await createFile(efs, 'dir', path.join(n0, n2), tuid, tuid);
          const inode = (await efs.lstat(path.join(n0, n2))).ino;

          setId(efs, tuid);
          await efs.rename(path.join(n0, n2), path.join(n1, n3));
          await expectError(efs.lstat(path.join(n0, n2)), errno.ENOENT);
          let stat = await efs.lstat(path.join(n1, n3));
          expect(stat.ino).toEqual(inode);
          expect(stat.uid).toEqual(tuid);
          expect(stat.gid).toEqual(tuid);
          await efs.rename(path.join(n1, n3), path.join(n0, n2));

          await efs.mkdir(path.join(n1, n3), dp);
          await efs.rename(path.join(n0, n2), path.join(n1, n3));
          await expectError(efs.lstat(path.join(n0, n2)), errno.ENOENT);
          stat = await efs.lstat(path.join(n1, n3));
          expect(stat.ino).toEqual(inode);
          expect(stat.uid).toEqual(tuid);
          expect(stat.gid).toEqual(tuid);
          await efs.rmdir(path.join(n1, n3));
        }
      });
      test("User doesn't own the source sticky directory nor the source directory.", async () => {
        for (let id = 0; id < 65533; id += 10000) {
          setId(efs, 0);
          await efs.chown(n0, id, id);
          await createFile(efs, 'dir', path.join(n0, n2), id, id);
          const inode = (await efs.lstat(path.join(n0, n2))).ino;

          setId(efs, tuid);
          await expectError(
            efs.rename(path.join(n0, n2), path.join(n1, n3)),
            errno.EACCES,
          );
          let stat = await efs.lstat(path.join(n0, n2));
          expect(stat.ino).toEqual(inode);
          expect(stat.uid).toEqual(id);
          expect(stat.gid).toEqual(id);
          await expectError(efs.lstat(path.join(n1, n3)), errno.ENOENT);

          await efs.mkdir(path.join(n1, n3), dp);
          await expectError(
            efs.rename(path.join(n0, n2), path.join(n1, n3)),
            errno.EACCES,
          );
          stat = await efs.lstat(path.join(n0, n2));
          expect(stat.ino).toEqual(inode);
          expect(stat.uid).toEqual(id);
          expect(stat.gid).toEqual(id);
          stat = await efs.lstat(path.join(n1, n3));
          expect(stat.uid).toEqual(tuid);
          expect(stat.gid).toEqual(tuid);
          await efs.rmdir(path.join(n0, n2));
          await efs.rmdir(path.join(n1, n3));
        }
      });
    });

    test.todo(
      "returns EACCES or EPERM if the file pointed at by the 'to' argument exists, the directory containing 'to' is marked sticky, and neither the containing directory nor 'to' are owned by the effective user ID (10)",
    );
    test('returns ELOOP if too many symbolic links were encountered in translating one of the pathnames (11)', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(efs.rename(path.join(n0, 'test'), n2), errno.ELOOP);
      await expectError(efs.rename(path.join(n0, 'test'), n1), errno.ELOOP);
      await createFile(efs, 'regular', n2);
      await expectError(efs.rename(n2, path.join(n0, 'test')), errno.ELOOP);
      await expectError(efs.rename(n2, path.join(n1, 'test')), errno.ELOOP);
    });
    describe('returns ENOTDIR if a component of either path prefix is not a directory (12)', () => {
      const types = ['regular', 'block', 'char'];
      test.each(types)('Type: %s', async (type) => {
        await efs.mkdir(n0, dp);
        await createFile(efs, type as FileTypes, path.join(n0, n1));
        await expectError(
          efs.rename(path.join(n0, n1, 'test'), path.join(n0, n2)),
          errno.ENOTDIR,
        );
        await createFile(efs, type as FileTypes, path.join(n0, n2));
        await expectError(
          efs.rename(path.join(n0, n2), path.join(n0, n1, 'test')),
          errno.ENOTDIR,
        );
      });
    });
    describe("returns ENOTDIR when the 'from' argument is a directory, but 'to' is not a directory (13)", () => {
      const types = ['regular', 'block', 'char', 'symlink'];
      test.each(types)('Type: %s', async (type) => {
        await efs.mkdir(n0, dp);
        await createFile(efs, type as FileTypes, n1);
        await expectError(efs.rename(n0, n1), errno.ENOTDIR);
      });
    });
    describe("returns EISDIR when the 'to' argument is a directory, but 'from' is not a directory (14)", () => {
      const types = ['regular', 'block', 'char', 'symlink'];
      test.each(types)('Type: %s', async (type) => {
        await efs.mkdir(n0, dp);
        await createFile(efs, type as FileTypes, n1);
        await expectError(efs.rename(n1, n0), errno.EISDIR);
      });
    });
    test("returns EINVAL when the 'from' argument is a parent directory of 'to' (18)", async () => {
      await efs.mkdir(n0, dp);
      await efs.mkdir(path.join(n0, n1), dp);

      await expectError(efs.rename(n0, path.join(n0, n1)), errno.EINVAL);
      await expectError(efs.rename(n0, path.join(n0, n1, n2)), errno.EINVAL);
    });
    describe("returns ENOTEMPTY if the 'to' argument is a directory and is not empty (20)", () => {
      test.each(supportedTypes)('Type: %s', async (type) => {
        await efs.mkdir(n0, dp);
        await efs.mkdir(n1, dp);
        await createFile(efs, type, path.join(n1, n2));
        await expectError(efs.rename(n0, n1), errno.ENOTEMPTY);
      });
    });
    test.todo(
      'write access to subdirectory is required to move it to another directory (21)',
    );
    describe('changes file ctime (22)', () => {
      test.each(supportedTypes)('Type: %s', async (type) => {
        const src = n0;
        const dst = n1;
        const parent = n2;

        await createFile(efs, type, src);
        const ctime1 = (await efs.lstat(src)).ctime.getTime();
        await sleep(10);
        await efs.rename(src, dst);
        const ctime2 = (await efs.lstat(dst)).ctime.getTime();
        expect(ctime1).toBeLessThan(ctime2);
      });
    });
    describe('succeeds when to is multiply linked (23)', () => {
      const types = ['regular', 'block', 'char'];
      test.each(types)('Type: %s', async (type) => {
        const src = n0;
        const dst = n1;
        const dstlnk = n2;

        await createFile(efs, type as FileTypes, src);
        await createFile(efs, type as FileTypes, dst);

        await efs.link(dst, dstlnk);
        const ctime1 = (await efs.lstat(dstlnk)).ctime.getTime();
        await sleep(10);

        await efs.rename(src, dst);

        // destination inode should have reduced nlink and updated ctime
        expect((await efs.lstat(dstlnk)).nlink).toEqual(1);
        const ctime2 = (await efs.lstat(dstlnk)).ctime.getTime();
        expect(ctime1).toBeLessThan(ctime2);
      });
    });
  });
});
