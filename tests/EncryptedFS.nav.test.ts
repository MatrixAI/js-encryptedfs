import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import { running } from '@matrixai/async-init';
import { code as errno } from 'errno';
import { EncryptedFS, constants } from '@';
import * as utils from '@/utils';
import * as errors from '@/errors';
import { expectError } from './utils';

describe('EncryptedFS Navigation', () => {
  const logger = new Logger('EncryptedFS Navigation', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let dbPath: string;
  const dbKey: Buffer = utils.generateKeySync(256);
  let efs: EncryptedFS;
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
  test('creation of EFS', async () => {
    expect(efs).toBeInstanceOf(EncryptedFS);
  });
  test('Validation of keys', async () => {
    await efs.stop();
    const falseDbKey = await utils.generateKey(256);
    await expect(
      EncryptedFS.createEncryptedFS({
        dbKey: falseDbKey,
        dbPath,
        umask: 0o022,
        logger,
      }),
    ).rejects.toThrow(errors.ErrorEncryptedFSKey);
    efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      umask: 0o022,
      logger,
    });
  });
  test('EFS using callback style functions', (done) => {
    const str = 'callback';
    const flags = constants.O_CREAT | constants.O_RDWR;
    const readBuffer = Buffer.alloc(str.length);
    /* eslint-disable @typescript-eslint/no-floating-promises */
    efs.mkdir('callback', () => {
      efs.open('callback/cb', flags, (err, fdIndex) => {
        expect(err).toBe(null);
        efs.write(fdIndex, str, 0, (err, bytesWritten) => {
          expect(err).toBe(null);
          expect(bytesWritten).toBe(str.length);
          efs.read(fdIndex, readBuffer, 0, str.length, (err, bytesRead) => {
            expect(err).toBe(null);
            expect(bytesRead).toBe(str.length);
            efs.close(fdIndex, () => {
              efs.unlink('callback/cb', () => {
                efs.rename('callback', 'cb', () => {
                  efs.symlink('callback', 'cb', () => {
                    efs.readdir('.', (err, list) => {
                      expect(err).toBe(null);
                      expect(list.sort()).toEqual(['cb'].sort());
                      efs.unlink('callback', () => {
                        efs.rmdir('cb', () => {
                          done();
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
    /* eslint-enable @typescript-eslint/no-floating-promises */
  });
  test('should be able to restore state', async () => {
    const buffer = Buffer.from('Hello World');
    await efs.writeFile(`hello-world`, buffer);
    await efs.stop();
    const efsReloaded = await EncryptedFS.createEncryptedFS({
      dbPath,
      dbKey,
      umask: 0o022,
      logger,
    });
    await efsReloaded.start();
    await expect(efsReloaded.readFile('hello-world')).resolves.toEqual(buffer);
    await efsReloaded.stop();
  });
  test('should be able to navigate before root', async () => {
    const buffer = Buffer.from('Hello World');
    await efs.mkdir(`first`);
    await efs.writeFile(`hello-world.txt`, buffer);
    let stat = await efs.stat(`first/../../../../../../first`);
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(true);
    stat = await efs.stat(`first/../../../../../../hello-world.txt`);
    expect(stat.isFile()).toStrictEqual(true);
    expect(stat.isDirectory()).toStrictEqual(false);
  });
  test('trailing slash refers to the directory instead of a file', async () => {
    await efs.writeFile(`abc`, '');
    await expectError(efs.access(`abc/`, undefined), errno.ENOTDIR);
    await expectError(efs.access(`abc/.`, undefined), errno.ENOTDIR);
    await expectError(efs.mkdir(`abc/.`), errno.ENOTDIR);
    await expectError(efs.mkdir(`abc/`), errno.EEXIST);
  });
  test('trailing slash works for non-existent directories when intending to create them', async () => {
    await efs.mkdir(`abc/`);
    const stat = await efs.stat(`abc/`);
    expect(stat.isDirectory()).toStrictEqual(true);
  });
  test('trailing `/.` for mkdir should result in errors', async () => {
    await expectError(efs.mkdir(`abc/.`), errno.ENOENT);
    await efs.mkdir(`abc`);
    await expectError(efs.mkdir(`abc/.`), errno.EEXIST);
  });
  test('navigating invalid paths', async () => {
    await efs.mkdir('/test/a/b/c', { recursive: true });
    await efs.mkdir('/test/a/bc', { recursive: true });
    await efs.mkdir('/test/abc', { recursive: true });
    await expectError(efs.readdir('/test/abc/a/b/c'), errno.ENOENT);
    await expectError(efs.readdir('/abc'), errno.ENOENT);
    await expectError(efs.stat('/test/abc/a/b/c'), errno.ENOENT);
    await expectError(efs.mkdir('/test/abc/a/b/c'), errno.ENOENT);
    await expectError(efs.writeFile('/test/abc/a/b/c', 'Hello'), errno.ENOENT);
    await expectError(efs.readFile('/test/abc/a/b/c'), errno.ENOENT);
    await expectError(efs.readFile('/test/abcd'), errno.ENOENT);
    await expectError(efs.mkdir('/test/abcd/dir'), errno.ENOENT);
    await expectError(efs.unlink('/test/abcd'), errno.ENOENT);
    await expectError(efs.unlink('/test/abcd/file'), errno.ENOENT);
    await expectError(efs.stat('/test/a/d/b/c'), errno.ENOENT);
    await expectError(efs.stat('/test/abcd'), errno.ENOENT);
  });
  test('various failure situations', async () => {
    await efs.mkdir('/test/dir', { recursive: true });
    await expectError(
      efs.mkdir('/test/dir', { recursive: true }),
      errno.EEXIST,
    );
    await efs.writeFile('/test/file', 'Hello');
    await expectError(efs.writeFile('/test/dir', 'Hello'), errno.EISDIR);
    await expectError(efs.writeFile('/', 'Hello'), errno.EISDIR);
    await expectError(efs.rmdir('/'), errno.EINVAL);
    await expectError(efs.unlink('/'), errno.EISDIR);
    await expectError(efs.mkdir('/test/dir'), errno.EEXIST);
    await expectError(efs.mkdir('/test/file'), errno.EEXIST);
    await expectError(
      efs.mkdir('/test/file', { recursive: true }),
      errno.EEXIST,
    );
    await expectError(efs.readdir('/test/file'), errno.ENOTDIR);
    await expectError(efs.readlink('/test/dir'), errno.EINVAL);
    await expectError(efs.readlink('/test/file'), errno.EINVAL);
  });
  test('cwd returns the absolute fully resolved path', async () => {
    await efs.mkdir('/a/b', { recursive: true });
    await efs.symlink('/a/b', '/c');
    await efs.chdir('/c');
    const cwd = efs.cwd;
    expect(cwd).toBe('/a/b');
  });
  test('cwd still works if the current directory is deleted', async () => {
    // Nodejs process.cwd() will actually throw ENOENT
    // but making it work in EFS is harmless
    await efs.mkdir('/removed');
    await efs.chdir('/removed');
    await efs.rmdir('../removed');
    expect(efs.cwd).toBe('/removed');
  });
  test('deleted current directory can still use . and .. for traversal', async () => {
    await efs.mkdir('/removed');
    const statRoot = await efs.stat('/');
    await efs.chdir('/removed');
    const statCurrent1 = await efs.stat('.');
    await efs.rmdir('../removed');
    const statCurrent2 = await efs.stat('.');
    const statParent = await efs.stat('..');
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
    await efs.mkdir('/removeda/removedb', { recursive: true });
    await efs.chdir('/removeda/removedb');
    await efs.rmdir('../removedb');
    await efs.rmdir('../../removeda');
    await efs.chdir('..');
    await efs.chdir('..');
    const path = efs.cwd;
    expect(path).toBe('/');
  });
  test('cannot chdir into a directory without execute permissions', async () => {
    await efs.mkdir('/dir');
    await efs.chmod('/dir', 0o666);
    efs.uid = 1000;
    await expectError(efs.chdir('/dir'), errno.EACCES);
  });
  test('should be able to access inodes inside chroot', async () => {
    await efs.mkdir('dir');
    const efs2 = await efs.chroot('dir');
    await efs.writeFile('dir/file', 'test');
    await expect(
      efs2.readFile('../../../file', { encoding: 'utf8' }),
    ).resolves.toBe('test');
    await efs2.mkdir('dir1/dir2/dir3', { recursive: true });
    await efs2.writeFile('dir1/dir2/dir3/test-file', 'test');
    await expect(
      efs.readFile('dir/dir1/dir2/dir3/test-file', { encoding: 'utf8' }),
    ).resolves.toBe('test');
  });
  test('should not be able to access inodes outside chroot', async () => {
    await efs.mkdir(`dir`);
    await efs.writeFile('file', 'test');
    const efs2 = await efs.chroot('dir');
    await efs.exists('/../../../file');
    await expect(efs2.exists('/../../../file')).resolves.toBeFalsy();
    await expectError(efs2.readFile('../../../file'), errno.ENOENT);
  });
  test('should not be able to access inodes outside chroot using symlink', async () => {
    await efs.mkdir(`dir`);
    await efs.writeFile('file', 'test');
    await efs.symlink('file', 'dir/link');
    const efs2 = await efs.chroot('dir');
    await expectError(efs2.readFile('link'), errno.ENOENT);
  });
  test('prevents users from changing current directory above the chroot', async () => {
    await efs.mkdir('dir');
    await efs.mkdir('dir1');
    const efs2 = await efs.chroot('dir');
    await efs2.chdir('/../');
    await expect(efs2.readdir('.')).resolves.toEqual([]);
    await expectError(efs2.chdir('/../dir1'), errno.ENOENT);
  });
  test('can sustain a current directory inside a chroot', async () => {
    await efs.mkdir('dir');
    await efs.chroot('dir');
    await efs.chdir('dir');
    await expect(efs.readdir('.')).resolves.toEqual([]);
  });
  test('can chroot, and then chroot again', async () => {
    await efs.mkdir('dir');
    const efs2 = await efs.chroot('dir');
    await efs2.mkdir('dir2');
    const efs3 = await efs2.chroot('dir2');
    await expect(efs3.readdir('.')).resolves.toEqual([]);
  });
  test('chroot returns a running efs instance', async () => {
    await efs.mkdir('dir');
    const efs2 = await efs.chroot('dir');
    expect(efs2[running]).toBe(true);
  });
  test('chroot start & stop does not affect other efs instances', async () => {
    await efs.mkdir('dir1');
    await efs.mkdir('dir2');
    await efs.mkdir('dir3');
    const efs1 = await efs.chroot('dir1');
    const efs2 = await efs.chroot('dir2');
    const efs3 = await efs.chroot('dir3');
    await efs1.stop();
    expect(efs1[running]).toBe(false);
    expect(efs2[running]).toBe(true);
    expect(efs3[running]).toBe(true);
    expect(efs[running]).toBe(true);
    await efs1.start();
    await efs2.stop();
    await efs3.stop();
    expect(efs1[running]).toBe(true);
    expect(efs2[running]).toBe(false);
    expect(efs3[running]).toBe(false);
    expect(efs[running]).toBe(true);
  });
  test('root efs instance stops all chrooted instances', async () => {
    await efs.mkdir('dir1');
    await efs.mkdir('dir2');
    await efs.mkdir('dir3');
    const efs1 = await efs.chroot('dir1');
    const efs2 = await efs.chroot('dir2');
    const efs3 = await efs.chroot('dir3');
    expect(efs1[running]).toBe(true);
    expect(efs2[running]).toBe(true);
    expect(efs3[running]).toBe(true);
    await efs.stop();
    expect(efs1[running]).toBe(false);
    expect(efs2[running]).toBe(false);
    expect(efs3[running]).toBe(false);
    await efs.start();
    // Chrooted instances are considered to be destroyed
    expect(efs1[running]).toBe(false);
    expect(efs2[running]).toBe(false);
    expect(efs3[running]).toBe(false);
  });
  test('destroying chroot is a noop', async () => {
    await efs.mkdir('dir');
    const efsChroot1 = await efs.chroot('dir');
    await efsChroot1.stop();
    await efsChroot1.destroy();
    // The underlying state is not destroyed
    const efsChroot2 = await efs.chroot('dir');
    await efsChroot2.stop();
  });
});
