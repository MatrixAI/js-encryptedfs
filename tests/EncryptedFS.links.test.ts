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
  fileTypes,
  supportedTypes,
  sleep,
  setId,
} from './utils';
import path from 'path';
import * as buffer from 'buffer';

describe('EncryptedFS Links', () => {
  const logger = new Logger('EncryptedFS Links', LogLevel.WARN, [
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
    await expectError(efs.rmdir(`linktodirectory`), errno.ENOTDIR);
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
    await expectError(efs.readFile('/test'), errno.ELOOP);
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
    await expectError(efs.readFile('/test/non-existent'), errno.ELOOP);
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
    await expectError(efs.link(`test`, `hardlinkttotest`), errno.EISDIR);
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

  describe('symlink', () => {
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
    test('creates symbolic links (00)', async () => {
      await createFile(efs, 'regular', n0);
      const stat = await efs.lstat(n0);
      // expect(stat.mode).toEqual(0o0644);
      await efs.symlink(n0, n1);
      // Should check that it is a link here.
      await efs.unlink(n0);
      await expectError(efs.stat(n1), errno.ENOENT);
      await efs.unlink(n1);

      await efs.mkdir(n0, dp);
      let stat2 = await efs.stat(n0);
      const time = stat2.birthtime.getTime();
      //sleep here if needed.
      await sleep(100);
      await efs.symlink('test', path.join(n0, n1));
      stat2 = await efs.stat(n0);
      const mtime = stat2.mtime.getTime();
      const ctime = stat2.ctime.getTime();
      expect(time).toBeLessThan(mtime);
      expect(time).toBeLessThan(ctime);
    });
    test('returns ENOENT if a component of the name2 path prefix does not exist (04)', async () => {
      await efs.mkdir(n0, dp);
      await expectError(
        efs.symlink('test', path.join(n0, n1, 'test')),
        errno.ENOENT,
      );
    });
    test('returns EACCES when a component of the name2 path prefix denies search permission (05)', async () => {
      await efs.mkdir(n1, dp);
      await efs.chown(n1, tuid, tuid);

      await efs.symlink('test', path.join(n1, n2));
      await efs.unlink(path.join(n1, n2));

      await efs.chmod(n1, 0o0644);
      setId(efs, tuid);
      await expectError(efs.symlink('test', path.join(n1, n2)), errno.EACCES);
      await efs.chmod(n1, dp);
      await efs.symlink('test', path.join(n1, n2));
      await efs.unlink(path.join(n1, n2));
    });
    test('returns EACCES if the parent directory of the file to be created denies write permission (06)', async () => {
      await efs.mkdir(n1, dp);
      await efs.chown(n1, tuid, tuid);

      setId(efs, tuid);
      await efs.symlink('test', path.join(n1, n2));
      await efs.unlink(path.join(n1, n2));

      // setId(efs, uid);
      await efs.chmod(n1, 0o0555);
      setId(efs, tuid);
      await expectError(efs.symlink('test', path.join(n1, n2)), errno.EACCES);
      await efs.chmod(n1, 0o0755);
      await efs.symlink('test', path.join(n1, n2));
      await efs.unlink(path.join(n1, n2));
    });
    test('returns ELOOP if too many symbolic links were encountered in translating the name2 path name (07)', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(
        efs.symlink('test', path.join(n0, 'test')),
        errno.ELOOP,
      );
      await expectError(
        efs.symlink('test', path.join(n1, 'test')),
        errno.ELOOP,
      );
      await efs.unlink(n0);
      await efs.unlink(n1);
    });
    describe('returns EEXIST if the name2 argument already exists (08)', () => {
      test.each(supportedTypes)('for %s', async (type) => {
        await createFile(efs, type, n0);
        await expectError(efs.symlink('test', n0), errno.EEXIST);
      });
    });
  });
  describe('unlink', () => {
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

    describe('removes regular files, symbolic links, fifos and sockets (00)', () => {
      const types = supportedTypes.filter((item) => {
        return item != 'dir' && item != 'symlink';
      });
      describe.each(types)('type: %s', (type) => {
        test('Can create and remove a link', async () => {
          await createFile(efs, type, n0);
          await efs.unlink(n0);
        });
        test('successful unlink(2) updates ctime', async () => {
          await createFile(efs, type, n0);
          await efs.link(n0, n1);
          const ctime1 = (await efs.stat(n0)).ctime.getTime();
          await sleep(10);
          await efs.unlink(n1);
          const ctime2 = (await efs.stat(n0)).ctime.getTime();
          expect(ctime1).toBeLessThan(ctime2);
        });
        test('unsuccessful unlink(2) does not update ctime.', async () => {
          await createFile(efs, type, n0);
          await efs.link(n0, n1);
          const ctime1 = (await efs.stat(n0)).ctime.getTime();
          await sleep(10);
          setId(efs, tuid);
          await expectError(efs.unlink(n1), errno.EACCES);
          const ctime2 = (await efs.stat(n0)).ctime.getTime();
          expect(ctime1).toEqual(ctime2);
        });
      });
    });
    test('returns ENOTDIR if a component of the path prefix is not a directory (01)', async () => {
      await efs.mkdir(n0, dp);
      await createFile(efs, 'regular', path.join(n0, n1));
      await expectError(efs.unlink(path.join(n0, n1, 'test')), errno.ENOTDIR);
    });
    test('returns ENOENT if the named file does not exist (04)', async () => {
      await createFile(efs, 'regular', n0);
      await efs.unlink(n0);
      await expectError(efs.unlink(n0), errno.ENOENT);
      await expectError(efs.unlink(n1), errno.ENOENT);
    });
    test('returns EACCES when search permission is denied for a component of the path prefix (05)', async () => {
      await efs.mkdir(n1, dp);
      await efs.chown(n1, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', path.join(n1, n2));
      await efs.chmod(n1, 0o0644);
      await expectError(efs.unlink(path.join(n1, n2)), errno.EACCES);
    });
    test('returns EACCES when write permission is denied on the directory containing the link to be removed (06)', async () => {
      await efs.mkdir(n1, dp);
      await efs.chown(n1, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', path.join(n1, n2));
      await efs.chmod(n1, 0o0555);
      await expectError(efs.unlink(path.join(n1, n2)), errno.EACCES);
    });
    test('returns ELOOP if too many symbolic links were encountered in translating the pathname (07)', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(efs.unlink(path.join(n0, 'test')), errno.ELOOP);
      await expectError(efs.unlink(path.join(n1, 'test')), errno.ELOOP);
    });
    test('may return EPERM if the named file is a directory (08)', async () => {
      await efs.mkdir(n0, dp);
      await expectError(efs.unlink(n0), errno.EISDIR); // was EPERM
      // await expectError(efs.rmdir(n0), errno.ENOENT); // Succeeds, I think that's intended.
    });
    describe('returns EACCES or EPERM if the directory containing the file is marked sticky, and neither the containing directory nor the file to be removed are owned by the effective user ID (11)', () => {
      beforeEach(async () => {
        await efs.mkdir(n0, dp);
        await efs.chmod(n0, 0o01777);
        await efs.chown(n0, tuid, tuid);
      });

      const types = supportedTypes.filter((item) => {
        return item != 'dir';
      });
      describe.each(types)('type: %s', (type) => {
        test('User owns both: the sticky directory and the file', async () => {
          const PUT = path.join(n0, n1);
          await efs.chown(n0, tuid, tuid);
          await createFile(efs, type, PUT, tuid, tuid);
          const stat = await efs.lstat(PUT);
          expect(stat.uid).toEqual(tuid);
          expect(stat.gid).toEqual(tuid);
          setId(efs, tuid);
          await efs.unlink(PUT);
          await expectError(efs.lstat(PUT), errno.ENOENT);
        });
        test("User owns the sticky directory, but doesn't own the file.", async () => {
          for (let id = 0; id < 65533; id += 0o10000) {
            // Spot checking ids
            const PUT = path.join(n0, n1);
            await efs.chown(n0, tuid, tuid);
            await createFile(efs, type, PUT, id, id);
            const stat = await efs.lstat(PUT);
            expect(stat.uid).toEqual(id);
            expect(stat.gid).toEqual(id);
            await efs.unlink(PUT);
            await expectError(efs.lstat(PUT), errno.ENOENT);
          }
        });
        test("User owns the file, but doesn't own the sticky directory.", async () => {
          for (let id = 0; id < 65533; id += 0o10000) {
            // Spot checking ids
            const PUT = path.join(n0, n1);
            await efs.chown(n0, id, id);
            await createFile(efs, type, PUT, tuid, tuid);
            const stat = await efs.lstat(PUT);
            expect(stat.uid).toEqual(tuid);
            expect(stat.gid).toEqual(tuid);
            await efs.unlink(PUT);
            await expectError(efs.lstat(PUT), errno.ENOENT);
          }
        });
        test("User doesn't own the sticky directory nor the file.", async () => {
          for (let id = 0; id < 65533; id += 0o10000) {
            // Spot checking ids
            const PUT = path.join(n0, n1);
            await efs.chown(n0, id, id);
            await createFile(efs, type, PUT, id, id);
            const stat = await efs.lstat(PUT);
            expect(stat.uid).toEqual(id);
            expect(stat.gid).toEqual(id);
            setId(efs, tuid);
            await expectError(efs.unlink(PUT), errno.ENOENT);
          }
        });
      });
    });
    test('An open file will not be immediately freed by unlink (14)', async () => {
      const message = 'Hello, World!';
      const message2 = 'Hello,_World!';
      await createFile(efs, 'regular', n0);
      let fd = await efs.open(n0, 'w');
      await efs.write(fd, message);
      await efs.unlink(n0);
      // A deleted file's link count should be 0
      const stat = await efs.fstat(fd);
      expect(stat.nlink).toEqual(0);
      await efs.close(fd);

      // I/O to open but deleted files should work, too
      await createFile(efs, 'regular', n0);
      fd = await efs.open(n0, 'r+');
      await efs.write(fd, message2, 0, 'utf-8');
      // await efs.unlink(n0);
      const buf = new Buffer(20);
      await efs.read(fd, buf);
      expect(buf).toEqual(message2);
    });
  });
  describe('link', () => {
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
    describe('creates hardlinks (00)', () => {
      const types = ['regular', 'block', 'char'];
      describe.each(types)('Type: %s', (type) => {
        test('creates links.', async () => {
          await createFile(efs, type as fileTypes, n0);
          expect((await efs.lstat(n0)).nlink).toEqual(1);

          await efs.link(n0, n1);
          expect((await efs.lstat(n0)).nlink).toEqual(2);
          expect((await efs.lstat(n1)).nlink).toEqual(2);

          await efs.link(n1, n2);
          expect((await efs.lstat(n0)).nlink).toEqual(3);
          expect((await efs.lstat(n1)).nlink).toEqual(3);
          expect((await efs.lstat(n2)).nlink).toEqual(3);

          await efs.chmod(n1, 0o0201);
          await efs.chown(n1, 0o65533, 0o65533);

          let stat = await efs.lstat(n0);
          // expect(stat.mode).toEqual(0o0201);
          expect(stat.nlink).toEqual(3);
          expect(stat.uid).toEqual(0o65533);
          expect(stat.gid).toEqual(0o65533);
          stat = await efs.lstat(n1);
          // expect(stat.mode).toEqual(0o0201);
          expect(stat.nlink).toEqual(3);
          expect(stat.uid).toEqual(0o65533);
          expect(stat.gid).toEqual(0o65533);
          stat = await efs.lstat(n2);
          // expect(stat.mode).toEqual(0o0201);
          expect(stat.nlink).toEqual(3);
          expect(stat.uid).toEqual(0o65533);
          expect(stat.gid).toEqual(0o65533);

          await efs.unlink(n0);
          await expectError(efs.lstat(n0), errno.ENOENT);
          stat = await efs.lstat(n1);
          // expect(stat.mode).toEqual(0o0201);
          expect(stat.nlink).toEqual(2);
          expect(stat.uid).toEqual(0o65533);
          expect(stat.gid).toEqual(0o65533);
          stat = await efs.lstat(n2);
          // expect(stat.mode).toEqual(0o0201);
          expect(stat.nlink).toEqual(2);
          expect(stat.uid).toEqual(0o65533);
          expect(stat.gid).toEqual(0o65533);

          await efs.unlink(n2);
          await expectError(efs.lstat(n0), errno.ENOENT);
          stat = await efs.lstat(n1);
          // expect(stat.mode).toEqual(0o0201);
          expect(stat.nlink).toEqual(1);
          expect(stat.uid).toEqual(0o65533);
          expect(stat.gid).toEqual(0o65533);
          await expectError(efs.lstat(n2), errno.ENOENT);

          await efs.unlink(n1);
          await expectError(efs.lstat(n0), errno.ENOENT);
          await expectError(efs.lstat(n1), errno.ENOENT);
          await expectError(efs.lstat(n2), errno.ENOENT);
        });
        test('successful link(2) updates ctime.', async () => {
          await createFile(efs, type as fileTypes, n0);
          const ctime1 = (await efs.stat(n0)).ctime.getTime();
          const dctime1 = (await efs.stat(n0)).ctime.getTime();
          const dmtime1 = (await efs.stat(n0)).mtime.getTime();
          await sleep(10);
          await efs.link(n0, n1);
          const ctime2 = (await efs.stat(n0)).ctime.getTime();
          expect(ctime1).toBeLessThan(ctime2);
          const dctime2 = (await efs.stat(n0)).ctime.getTime();
          expect(dctime1).toBeLessThan(dctime2);
          console.log(await efs.stat(n0));
          const dmtime2 = (await efs.stat(n0)).mtime.getTime();
          expect(dctime1).toBeLessThan(dmtime2);
        });
        test('unsuccessful link(2) does not update ctime.', async () => {
          await createFile(efs, type as fileTypes, n0);
          await efs.chown(n0, 0o65534, -1);
          const ctime1 = (await efs.stat(n0)).ctime.getTime();
          const dctime1 = (await efs.stat(n0)).ctime.getTime();
          const dmtime1 = (await efs.stat(n0)).mtime.getTime();
          await sleep(10);
          setId(efs, 0o65534);
          await expectError(efs.link(n0, n1), errno.EACCES);
          const ctime2 = (await efs.stat(n0)).ctime.getTime();
          expect(ctime1).toEqual(ctime2);
          const dctime2 = (await efs.stat(n0)).ctime.getTime();
          expect(dctime1).toEqual(dctime2);
          const dmtime2 = (await efs.stat(n0)).mtime.getTime();
          expect(dctime1).toEqual(dmtime2);
        });
      });
    });
    describe('returns ENOTDIR if a component of either path prefix is not a directory (01)', () => {
      test.each(supportedTypes)('%s', async (type) => {
        await efs.mkdir(n0, dp);
        await createFile(efs, type as fileTypes, path.join(n0, n1));
        await expectError(
          efs.link(path.join(n0, n1, 'test'), path.join(n0, n2)),
          errno.ENOTDIR,
        );
        await createFile(efs, type as fileTypes, path.join(n0, n2));
        await expectError(
          efs.link(path.join(n0, n2), path.join(n0, n1, 'test')),
          errno.ENOTDIR,
        );
      });
    });
    test('returns EACCES when a component of either path prefix denies search permission (06)', async () => {
      await efs.mkdir(n1, dp);
      await efs.chown(n1, tuid, tuid);
      await efs.mkdir(n2, dp);
      await efs.chown(n2, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', path.join(n1, n3));

      await efs.link(path.join(n1, n3), path.join(n2, n4));
      await efs.unlink(path.join(n2, n4));

      await efs.chmod(n1, 0o0644);
      await expectError(
        efs.link(path.join(n1, n3), path.join(n1, n4)),
        errno.EACCES,
      );
      await expectError(
        efs.link(path.join(n1, n3), path.join(n2, n4)),
        errno.EACCES,
      );

      await efs.chmod(n1, 0o0755);
      await efs.chmod(n2, 0o0644);
      await expectError(
        efs.link(path.join(n1, n3), path.join(n2, n4)),
        errno.EACCES,
      );
    });
    test('returns EACCES when the requested link requires writing in a directory with a mode that denies write permission (07)', async () => {
      await efs.mkdir(n1, dp);
      await efs.chown(n1, tuid, tuid);
      await efs.mkdir(n2, dp);
      await efs.chown(n2, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', path.join(n1, n3));

      await efs.link(path.join(n1, n3), path.join(n2, n4));
      await efs.unlink(path.join(n2, n4));

      await efs.chmod(n2, 0o0555);
      await expectError(
        efs.link(path.join(n1, n3), path.join(n2, n4)),
        errno.EACCES,
      );
      await efs.chmod(n1, 0o0555);
      await expectError(
        efs.link(path.join(n1, n3), path.join(n1, n4)),
        errno.EACCES,
      );
    });
    test('returns ELOOP if too many symbolic links were encountered in translating one of the pathnames (08)', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(efs.link(path.join(n0, 'test'), n2), errno.ELOOP);
      await expectError(efs.link(path.join(n1, 'test'), n2), errno.ELOOP);
      await createFile(efs, 'regular', n2);
      await expectError(efs.link(n2, path.join(n0, 'test')), errno.ELOOP);
      await expectError(efs.link(n2, path.join(n1, 'test')), errno.ELOOP);
    });
    test('returns ENOENT if the source file does not exist (09)', async () => {
      await createFile(efs, 'regular', n0);
      await efs.link(n0, n1);
      await efs.unlink(n0);
      await efs.unlink(n1);
      await expectError(efs.link(n0, n1), errno.ENOENT);
    });
    describe('returns EEXIST if the destination file does exist (10)', () => {
      test.each(supportedTypes)('Type: %s', async (type) => {
        await createFile(efs, type, n1);
        await expectError(efs.link(n0, n1), errno.EEXIST);
      });
    });
    test('returns EPERM if the source file is a directory (11)', async () => {
      await efs.mkdir(n0);
      await expectError(efs.link(n0, n1), errno.EPERM);

      await efs.mkdir(n2, dp);
      await efs.chown(n2, tuid, tuid);
      setId(efs, tuid);
      await expectError(efs.link(n2, n3), errno.EPERM);
    });
  });
});
