import type { FileTypes } from './utils';
import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import { code as errno } from 'errno';
import EncryptedFS from '@/EncryptedFS';
import { ErrorEncryptedFSError } from '@/errors';
import * as utils from '@/utils';
import { expectError, createFile, supportedTypes, sleep, setId } from './utils';

describe(`${EncryptedFS.name} Links`, () => {
  const logger = new Logger(`${EncryptedFS.name} Links`, LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const dbKey: Buffer = utils.generateKeySync(256);
  let dataDir: string;
  let efs: EncryptedFS;
  const n0 = 'zero';
  const n1 = 'one';
  const n2 = 'two';
  const n3 = 'three';
  const n4 = 'four';
  const dp = 0o0755;
  const tuid = 0o65534;
  let types: FileTypes[];
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      pathNode.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    efs = await EncryptedFS.createEncryptedFS({
      dbPath: dataDir,
      dbKey,
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
  test('Symlink stat makes sense', async () => {
    await efs.writeFile(`a`, 'data');
    await efs.symlink(`a`, `link-to-a`);
    await efs.lchown('link-to-a', 1000, 1000);
    const stat = await efs.lstat(`link-to-a`);
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(false);
    expect(stat.isSocket()).toStrictEqual(false);
    expect(stat.isSymbolicLink()).toStrictEqual(true);
    expect(stat.isFIFO()).toStrictEqual(false);
    expect(stat.uid).toBe(1000);
    expect(stat.gid).toBe(1000);
  });
  describe('symlink', () => {
    test('creates symbolic links', async () => {
      await createFile(efs, 'regular', n0);
      // Const stat = await efs.lstat(n0);
      // Expect(stat.mode).toEqual(0o0644);
      await efs.symlink(n0, n1);
      // Should check that it is a link here
      await efs.unlink(n0);
      await expectError(efs.stat(n1), ErrorEncryptedFSError, errno.ENOENT);
      await efs.unlink(n1);

      await efs.mkdir(n0, { mode: dp });
      let stat2 = await efs.stat(n0);
      const time = stat2.birthtime.getTime();
      await sleep(100);
      await efs.symlink('test', utils.pathJoin(n0, n1));
      stat2 = await efs.stat(n0);
      const mtime = stat2.mtime.getTime();
      const ctime = stat2.ctime.getTime();
      expect(time).toBeLessThan(mtime);
      expect(time).toBeLessThan(ctime);
    });
    test('paths can contain multiple slashes', async () => {
      await efs.mkdir(`dir`);
      await efs.writeFile(`dir/test`, 'hello');
      await efs.symlink(`///dir////test`, `linktodirtest`);
      const linkContents = await efs.readFile(`linktodirtest`);
      await expect(efs.readFile(`dir/test`)).resolves.toEqual(linkContents);
    });
    test('can resolve 1 symlink loop', async () => {
      await efs.symlink('/test', '/test');
      await expectError(
        efs.readFile('/test'),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
    });
    test('can resolve 2 symlink loops', async () => {
      await efs.mkdir('/dirtolink');
      await efs.symlink('/dirtolink/test', '/test');
      await efs.symlink('/test', '/dirtolink/test');
      await expectError(
        efs.readFile('/test/non-existent'),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
    });
    test('can be expanded by realpath', async () => {
      await efs.writeFile('/test', Buffer.from('Hello'));
      await efs.symlink('./test', '/linktotest');
      await efs.mkdir('/dirwithlinks');
      await efs.symlink('../linktotest', '/dirwithlinks/linktolink');
      const realPath = await efs.realpath('/dirwithlinks/linktolink');
      expect(realPath).toBe('/test');
    });
    test('cannot be traversed by rmdir', async () => {
      await efs.mkdir(`directory`);
      await efs.symlink(`directory`, `linktodirectory`);
      await expectError(
        efs.rmdir(`linktodirectory`),
        ErrorEncryptedFSError,
        errno.ENOTDIR,
      );
    });
    test('is able to be added and traversed transitively', async () => {
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
      await efs.mkdir('/test');
      const buf = Buffer.from('Hello World');
      await efs.writeFile('/a', buf);
      await efs.symlink('../a', '/test/linktoa');
      await expect(
        efs.readFile('/test/linktoa', { encoding: 'utf-8' }),
      ).resolves.toBe('Hello World');
    });
    test('returns EACCES when a component of the 2nd name path prefix denies search permission', async () => {
      await efs.mkdir(n1, { mode: dp });
      await efs.chown(n1, tuid, tuid);

      await efs.symlink('test', utils.pathJoin(n1, n2));
      await efs.unlink(utils.pathJoin(n1, n2));

      await efs.chmod(n1, 0o0644);
      setId(efs, tuid);
      await expectError(
        efs.symlink('test', utils.pathJoin(n1, n2)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await efs.chmod(n1, dp);
      await efs.symlink('test', utils.pathJoin(n1, n2));
      await efs.unlink(utils.pathJoin(n1, n2));
    });
    test('returns EACCES if the parent directory of the file to be created denies write permission', async () => {
      await efs.mkdir(n1, { mode: dp });
      await efs.chown(n1, tuid, tuid);

      setId(efs, tuid);
      await efs.symlink('test', utils.pathJoin(n1, n2));
      await efs.unlink(utils.pathJoin(n1, n2));

      await efs.chmod(n1, 0o0555);
      setId(efs, tuid);
      await expectError(
        efs.symlink('test', utils.pathJoin(n1, n2)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await efs.chmod(n1, 0o0755);
      await efs.symlink('test', utils.pathJoin(n1, n2));
      await efs.unlink(utils.pathJoin(n1, n2));
    });
    test('returns ELOOP if too many symbolic links were encountered in translating the name2 path name', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(
        efs.symlink('test', utils.pathJoin(n0, 'test')),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await expectError(
        efs.symlink('test', utils.pathJoin(n1, 'test')),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await efs.unlink(n0);
      await efs.unlink(n1);
    });
    test.each(supportedTypes)(
      'returns EEXIST if the 2nd name argument already exists as a %s',
      async (type) => {
        await createFile(efs, type, n0);
        await expectError(
          efs.symlink('test', n0),
          ErrorEncryptedFSError,
          errno.EEXIST,
        );
      },
    );
  });
  describe('unlink', () => {
    types = supportedTypes.filter((item) => {
      return item !== 'dir' && item !== 'symlink';
    });
    test.each(types)('can remove a link to a %s', async (type) => {
      await createFile(efs, type, n0);
      await efs.unlink(n0);
    });
    test.each(types)('successful updates ctime of a %s', async (type) => {
      await createFile(efs, type, n0);
      await efs.link(n0, n1);
      const ctime1 = (await efs.stat(n0)).ctime.getTime();
      await sleep(10);
      await efs.unlink(n1);
      const ctime2 = (await efs.stat(n0)).ctime.getTime();
      expect(ctime1).toBeLessThan(ctime2);
    });
    test.each(types)(
      'unsuccessful does not update ctime of a %s',
      async (type) => {
        await createFile(efs, type, n0);
        await efs.link(n0, n1);
        const ctime1 = (await efs.stat(n0)).ctime.getTime();
        await sleep(10);
        setId(efs, tuid);
        await expectError(efs.unlink(n1), ErrorEncryptedFSError, errno.EACCES);
        const ctime2 = (await efs.stat(n0)).ctime.getTime();
        expect(ctime1).toEqual(ctime2);
      },
    );
    test('does not traverse symlinks', async () => {
      await efs.mkdir(`test`);
      const buffer = Buffer.from('Hello World');
      await efs.writeFile(`test/hello-world.txt`, buffer);
      await efs.symlink(`test`, `linktotestdir`, 'dir');
      await efs.symlink(`linktotestdir/hello-world.txt`, `linktofile`);
      await efs.unlink(`linktofile`);
      await efs.unlink(`linktotestdir`);
      await expect(efs.readdir(`test`)).resolves.toContain('hello-world.txt');
    });
    test('returns ENOTDIR if a component of the path prefix is not a directory', async () => {
      await efs.mkdir(n0, { mode: dp });
      await createFile(efs, 'regular', utils.pathJoin(n0, n1));
      await expectError(
        efs.unlink(utils.pathJoin(n0, n1, 'test')),
        ErrorEncryptedFSError,
        errno.ENOTDIR,
      );
    });
    test('returns ENOENT if the named file does not exist', async () => {
      await createFile(efs, 'regular', n0);
      await efs.unlink(n0);
      await expectError(efs.unlink(n0), ErrorEncryptedFSError, errno.ENOENT);
      await expectError(efs.unlink(n1), ErrorEncryptedFSError, errno.ENOENT);
    });
    test('returns EACCES when search permission is denied for a component of the path prefix', async () => {
      await efs.mkdir(n1, { mode: dp });
      await efs.chown(n1, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', utils.pathJoin(n1, n2));
      await efs.chmod(n1, 0o0644);
      await expectError(
        efs.unlink(utils.pathJoin(n1, n2)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
    });
    test('returns EACCES when write permission is denied on the directory containing the link to be removed', async () => {
      await efs.mkdir(n1, { mode: dp });
      await efs.chown(n1, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', utils.pathJoin(n1, n2));
      await efs.chmod(n1, 0o0555);
      await expectError(
        efs.unlink(utils.pathJoin(n1, n2)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
    });
    test('returns ELOOP if too many symbolic links were encountered in translating the pathname', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(
        efs.unlink(utils.pathJoin(n0, 'test')),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await expectError(
        efs.unlink(utils.pathJoin(n1, 'test')),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
    });
    test('returns EISDIR if the named file is a directory', async () => {
      await efs.mkdir(n0, { mode: dp });
      await expectError(efs.unlink(n0), ErrorEncryptedFSError, errno.EISDIR);
    });
    test('will not immeadiately free a file', async () => {
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
      await efs.unlink(n0);
      const buf = Buffer.alloc(13);
      await efs.read(fd, buf, 0, buf.length);
      expect(buf).toEqual(Buffer.from(message2));
    });
  });
  describe('link', () => {
    types = ['regular', 'block'];
    test.each(types)('creates hardlinks to %s', async (type) => {
      await createFile(efs, type as FileTypes, n0);
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
      // Expect(stat.mode).toEqual(0o0201);
      expect(stat.nlink).toEqual(3);
      expect(stat.uid).toEqual(0o65533);
      expect(stat.gid).toEqual(0o65533);
      stat = await efs.lstat(n1);
      // Expect(stat.mode).toEqual(0o0201);
      expect(stat.nlink).toEqual(3);
      expect(stat.uid).toEqual(0o65533);
      expect(stat.gid).toEqual(0o65533);
      stat = await efs.lstat(n2);
      // Expect(stat.mode).toEqual(0o0201);
      expect(stat.nlink).toEqual(3);
      expect(stat.uid).toEqual(0o65533);
      expect(stat.gid).toEqual(0o65533);

      await efs.unlink(n0);
      await expectError(efs.lstat(n0), ErrorEncryptedFSError, errno.ENOENT);
      stat = await efs.lstat(n1);
      // Expect(stat.mode).toEqual(0o0201);
      expect(stat.nlink).toEqual(2);
      expect(stat.uid).toEqual(0o65533);
      expect(stat.gid).toEqual(0o65533);
      stat = await efs.lstat(n2);
      // Expect(stat.mode).toEqual(0o0201);
      expect(stat.nlink).toEqual(2);
      expect(stat.uid).toEqual(0o65533);
      expect(stat.gid).toEqual(0o65533);

      await efs.unlink(n2);
      await expectError(efs.lstat(n0), ErrorEncryptedFSError, errno.ENOENT);
      stat = await efs.lstat(n1);
      // Expect(stat.mode).toEqual(0o0201);
      expect(stat.nlink).toEqual(1);
      expect(stat.uid).toEqual(0o65533);
      expect(stat.gid).toEqual(0o65533);
      await expectError(efs.lstat(n2), ErrorEncryptedFSError, errno.ENOENT);

      await efs.unlink(n1);
      await expectError(efs.lstat(n0), ErrorEncryptedFSError, errno.ENOENT);
      await expectError(efs.lstat(n1), ErrorEncryptedFSError, errno.ENOENT);
      await expectError(efs.lstat(n2), ErrorEncryptedFSError, errno.ENOENT);
    });
    test.each(types)('successful updates ctime of %s', async (type) => {
      await createFile(efs, type as FileTypes, n0);
      const ctime1 = (await efs.stat(n0)).ctime.getTime();
      const dctime1 = (await efs.stat('.')).ctime.getTime();
      await sleep(10);
      await efs.link(n0, n1);
      const ctime2 = (await efs.stat(n0)).ctime.getTime();
      expect(ctime1).toBeLessThan(ctime2);
      const dctime2 = (await efs.stat('.')).ctime.getTime();
      expect(dctime1).toBeLessThan(dctime2);
      const dmtime2 = (await efs.stat('.')).mtime.getTime();
      expect(dctime1).toBeLessThan(dmtime2);
    });
    test.each(types)(
      'unsuccessful does not update ctime of %s',
      async (type) => {
        await createFile(efs, type as FileTypes, n0);
        await efs.chown(n0, 0o65534, -1);
        const ctime1 = (await efs.stat(n0)).ctime.getTime();
        const dctime1 = (await efs.stat(n0)).ctime.getTime();
        const dmtime1 = (await efs.stat(n0)).mtime.getTime();
        await sleep(10);
        setId(efs, 0o65534);
        await expectError(
          efs.link(n0, n1),
          ErrorEncryptedFSError,
          errno.EACCES,
        );
        const ctime2 = (await efs.stat(n0)).ctime.getTime();
        expect(ctime1).toEqual(ctime2);
        const dctime2 = (await efs.stat(n0)).ctime.getTime();
        expect(dctime1).toEqual(dctime2);
        const dmtime2 = (await efs.stat(n0)).mtime.getTime();
        expect(dmtime1).toEqual(dmtime2);
      },
    );
    test('should not create hardlinks to directories', async () => {
      await efs.mkdir(`test`);
      await expectError(
        efs.link(`test`, `hardlinkttotest`),
        ErrorEncryptedFSError,
        errno.EPERM,
      );
    });
    test('can create multiple hardlinks to the same file', async () => {
      await efs.mkdir(`test`);
      await efs.writeFile(`test/a`, '');
      await efs.link(`test/a`, `test/b`);
      const inoA = (await efs.stat(`test/a`)).ino;
      const inoB = (await efs.stat(`test/b`)).ino;
      expect(inoA).toEqual(inoB);
      const readB = await efs.readFile(`test/b`);
      await expect(efs.readFile(`test/a`)).resolves.toEqual(readB);
    });
    test.each(supportedTypes)(
      'returns ENOTDIR if a component of either path prefix is a %s',
      async (type) => {
        if (type !== 'dir' && type !== 'symlink') {
          await efs.mkdir(n0, { mode: dp });
          await createFile(efs, type as FileTypes, utils.pathJoin(n0, n1));
          await expectError(
            efs.link(utils.pathJoin(n0, n1, 'test'), utils.pathJoin(n0, n2)),
            ErrorEncryptedFSError,
            errno.ENOTDIR,
          );
          await createFile(efs, type as FileTypes, utils.pathJoin(n0, n2));
          await expectError(
            efs.link(utils.pathJoin(n0, n2), utils.pathJoin(n0, n1, 'test')),
            ErrorEncryptedFSError,
            errno.ENOTDIR,
          );
        }
      },
    );
    test('returns EACCES when a component of either path prefix denies search permission', async () => {
      await efs.mkdir(n1, { mode: dp });
      await efs.chown(n1, tuid, tuid);
      await efs.mkdir(n2, { mode: dp });
      await efs.chown(n2, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', utils.pathJoin(n1, n3));
      await efs.link(utils.pathJoin(n1, n3), utils.pathJoin(n2, n4));
      await efs.unlink(utils.pathJoin(n2, n4));
      await efs.chmod(n1, 0o0644);
      await expectError(
        efs.link(utils.pathJoin(n1, n3), utils.pathJoin(n1, n4)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await expectError(
        efs.link(utils.pathJoin(n1, n3), utils.pathJoin(n2, n4)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await efs.chmod(n1, 0o0755);
      await efs.chmod(n2, 0o0644);
      await expectError(
        efs.link(utils.pathJoin(n1, n3), utils.pathJoin(n2, n4)),
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
      await createFile(efs, 'regular', utils.pathJoin(n1, n3));

      await efs.link(utils.pathJoin(n1, n3), utils.pathJoin(n2, n4));
      await efs.unlink(utils.pathJoin(n2, n4));

      await efs.chmod(n2, 0o0555);
      await expectError(
        efs.link(utils.pathJoin(n1, n3), utils.pathJoin(n2, n4)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
      await efs.chmod(n1, 0o0555);
      await expectError(
        efs.link(utils.pathJoin(n1, n3), utils.pathJoin(n1, n4)),
        ErrorEncryptedFSError,
        errno.EACCES,
      );
    });
    test('returns ELOOP if too many symbolic links were encountered in translating one of the pathnames', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(
        efs.link(utils.pathJoin(n0, 'test'), n2),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await expectError(
        efs.link(utils.pathJoin(n1, 'test'), n2),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await createFile(efs, 'regular', n2);
      await expectError(
        efs.link(n2, utils.pathJoin(n0, 'test')),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
      await expectError(
        efs.link(n2, utils.pathJoin(n1, 'test')),
        ErrorEncryptedFSError,
        errno.ELOOP,
      );
    });
    test('returns ENOENT if the source file does not exist', async () => {
      await createFile(efs, 'regular', n0);
      await efs.link(n0, n1);
      await efs.unlink(n0);
      await efs.unlink(n1);
      await expectError(efs.link(n0, n1), ErrorEncryptedFSError, errno.ENOENT);
    });
    test.each(supportedTypes)(
      'returns EEXIST if the destination %s does exist',
      async (type) => {
        await efs.writeFile(n0, '');
        await createFile(efs, type, n1);
        await expectError(
          efs.link(n0, n1),
          ErrorEncryptedFSError,
          errno.EEXIST,
        );
      },
    );
    test('returns EPERM if the source file is a directory', async () => {
      await efs.mkdir(n0);
      await expectError(efs.link(n0, n1), ErrorEncryptedFSError, errno.EPERM);

      await efs.mkdir(n2, { mode: dp });
      await efs.chown(n2, tuid, tuid);
      setId(efs, tuid);
      await expectError(efs.link(n2, n3), ErrorEncryptedFSError, errno.EPERM);
    });
  });
});
