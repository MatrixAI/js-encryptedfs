import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import * as utils from '@/utils';
import {
  EncryptedFS,
  constants,
  errno,
  DB,
  INodeManager,
  DeviceManager,
} from '@';
import { expectError } from './utils';

describe('EncryptedFS Navigation', () => {
  const logger = new Logger('EncryptedFS Navigation', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let dbPath: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
  let iNodeMgr: INodeManager;
  const devMgr = new DeviceManager();
  let efs: EncryptedFS;
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
    efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
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
  test('creation of EFS', async () => {
    expect(efs).toBeInstanceOf(EncryptedFS);
  });
  test('EFS using callback style functions', (done) => {
    const str = 'callback';
    const flags = constants.O_CREAT | constants.O_RDWR;
    const readBuffer = Buffer.alloc(str.length);
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
    await efs.mkdirp('/test/a/b/c');
    await efs.mkdirp('/test/a/bc');
    await efs.mkdirp('/test/abc');
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
    await efs.mkdirp('/test/dir');
    await efs.mkdirp('/test/dir');
    await efs.writeFile('/test/file', 'Hello');
    await expectError(efs.writeFile('/test/dir', 'Hello'), errno.EISDIR);
    await expectError(efs.writeFile('/', 'Hello'), errno.EISDIR);
    await expectError(efs.rmdir('/'), errno.EINVAL);
    await expectError(efs.unlink('/'), errno.EISDIR);
    await expectError(efs.mkdir('/test/dir'), errno.EEXIST);
    await expectError(efs.mkdir('/test/file'), errno.EEXIST);
    await expectError(efs.mkdirp('/test/file'), errno.ENOTDIR);
    await expectError(efs.readdir('/test/file'), errno.ENOTDIR);
    await expectError(efs.readlink('/test/dir'), errno.EINVAL);
    await expectError(efs.readlink('/test/file'), errno.EINVAL);
  });
  test('cwd returns the absolute fully resolved path', async () => {
    await efs.mkdirp('/a/b');
    await efs.symlink('/a/b', '/c');
    await efs.chdir('/c');
    const cwd = efs.cwd;
    expect(cwd).toBe('/a/b');
  });
  test('cwd still works if the current directory is deleted', async () => {
    // Nodejs process.cwd() will actually throw ENOENT
    // but making it work in VFS is harmless
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
    await efs.mkdir('/dir');
    await efs.chmod('/dir', 0o666);
    efs.uid = 1000;
    await expectError(efs.chdir('/dir'), errno.EACCES);
  });
});
