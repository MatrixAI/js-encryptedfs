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
import { expectError } from './utils';

describe('EncryptedFS Permissions', () => {
  const logger = new Logger('EncryptedFS Permissions', LogLevel.WARN, [
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
    await efs.chown(`test`, 1000, 2000);
    const stat = (await efs.stat(`test`)) as vfs.Stat;
    expect(stat.uid).toEqual(1000);
    expect(stat.gid).toEqual(2000);
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
    const stat = (await efs.stat(`a`)) as vfs.Stat;
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
    await efs.access(
      `test`,
      vfs.constants.F_OK | vfs.constants.R_OK | vfs.constants.W_OK,
    );
    await efs.chmod(`test`, 0o444);
    await efs.access(`test`, vfs.constants.F_OK | vfs.constants.R_OK);
  });
  test('umask is correctly applied', async () => {
    const umask = 0o127;
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
      stat.mode &
        (vfs.constants.S_IRWXU | vfs.constants.S_IRWXG | vfs.constants.S_IRWXO),
    ).toBe(vfs.DEFAULT_FILE_PERM & ~umask);
    stat = await efs.stat('/dir');
    expect(
      stat.mode &
        (vfs.constants.S_IRWXU | vfs.constants.S_IRWXG | vfs.constants.S_IRWXO),
    ).toBe(vfs.DEFAULT_DIRECTORY_PERM & ~umask);
    // umask is not applied to symlinks
    stat = await efs.lstat('/symlink');
    expect(
      stat.mode &
        (vfs.constants.S_IRWXU | vfs.constants.S_IRWXG | vfs.constants.S_IRWXO),
    ).toBe(vfs.DEFAULT_SYMLINK_PERM);
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
    await expectError(efs.chown('file', 2000, 2000), errno.EPERM);
    // if you don't own the file, you also cannot change (even if your change is noop)
    efs.uid = 3000;
    await expectError(efs.chown('file', 1000, 1000), errno.EPERM);
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
    await expectError(efs.chmod('file', 0o777), errno.EPERM);
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
      vfs.constants.R_OK | vfs.constants.W_OK | vfs.constants.X_OK,
    );
    await efs.access(
      'dir',
      vfs.constants.R_OK | vfs.constants.W_OK | vfs.constants.X_OK,
    );
    efs.uid = 2000;
    await efs.access('testfile', vfs.constants.R_OK | vfs.constants.W_OK);
    await efs.access('dir', vfs.constants.R_OK | vfs.constants.W_OK);
    await expectError(efs.access('testfile', vfs.constants.X_OK), errno.EACCES);
    await expectError(efs.access('dir', vfs.constants.X_OK), errno.EACCES);
    efs.gid = 2000;
    await efs.access('testfile', vfs.constants.R_OK);
    await efs.access('dir', vfs.constants.R_OK);
    await expectError(efs.access('testfile', fs.constants.W_OK | fs.constants.X_OK), errno.EACCES);
    await expectError(efs.access('dir', fs.constants.W_OK | fs.constants.X_OK), errno.EACCES);
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
      vfs.constants.R_OK | vfs.constants.W_OK | vfs.constants.X_OK,
    );
    await efs.access(
      'dir',
      vfs.constants.R_OK | vfs.constants.W_OK | vfs.constants.X_OK,
    );
    efs.uid = vfs.DEFAULT_ROOT_UID;
    efs.uid = vfs.DEFAULT_ROOT_GID;
    await efs.chown('testfile', 2000, 1000);
    await efs.chown('dir', 2000, 1000);
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.access('testfile', vfs.constants.R_OK | vfs.constants.W_OK);
    await efs.access('dir', vfs.constants.R_OK | vfs.constants.W_OK);
    await expectError(efs.access('testfile', vfs.constants.X_OK), errno.EACCES);
    await expectError(efs.access('dir', vfs.constants.X_OK), errno.EACCES);
    efs.uid = vfs.DEFAULT_ROOT_UID;
    efs.uid = vfs.DEFAULT_ROOT_GID;
    await efs.chown('testfile', 2000, 2000);
    await efs.chown('dir', 2000, 2000);
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.access('testfile', vfs.constants.R_OK);
    await efs.access('dir', vfs.constants.R_OK);
    await expectError(efs.access('testfile', vfs.constants.W_OK | vfs.constants.X_OK), errno.EACCES);
    await expectError(efs.access('dir', vfs.constants.W_OK | vfs.constants.X_OK), errno.EACCES);
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
    await expectError(efs.access(`file`, vfs.constants.R_OK | vfs.constants.W_OK), errno.EACCES);
    await expectError(efs.access(`dir`, vfs.constants.R_OK | vfs.constants.W_OK), errno.EACCES);
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.writeFile(`file`, 'hello');
    await efs.chmod(`file`, 0o000);
    await expectError(efs.access(`file`, vfs.constants.X_OK), errno.EACCES);
    await expectError(efs.open(`file`, 'r'), errno.EACCES);
    await expectError(efs.open(`file`, 'w'), errno.EACCES);
    const stat = (await efs.stat(`file`)) as vfs.Stat;
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    const str = 'hello';
    await efs.writeFile(`file`, str);
    await efs.chmod(`file`, 0o400);
    await expectError(efs.access(`file`, vfs.constants.X_OK), errno.EACCES);
    await expect(efs.readFile(`file`, { encoding: 'utf8' })).resolves.toEqual(
      str,
    );
    await expectError(efs.open(`file`, 'w'), errno.EACCES);
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.writeFile(`file`, 'world', { mode: 0o666 });
    await efs.chmod(`file`, 0o600);
    await expectError(efs.access(`file`, vfs.constants.X_OK), errno.EACCES);
    const str = 'hello';
    await efs.writeFile(`file`, str);
    await expect(efs.readFile(`file`, { encoding: 'utf8' })).resolves.toEqual(
      str,
    );
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.writeFile(`file`, 'world', { mode: 0o777 });
    await efs.chmod(`file`, 0o700);
    await efs.access(`file`, vfs.constants.X_OK);
    const str = 'hello';
    await efs.writeFile(`file`, str);
    await expect(efs.readFile(`file`, { encoding: 'utf8' })).resolves.toEqual(
      str,
    );
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    const str = 'hello';
    await efs.writeFile(`file`, str);
    await efs.chmod(`file`, 0o500);
    await efs.access(`file`, vfs.constants.X_OK);
    await expect(efs.readFile(`file`, { encoding: 'utf8' })).resolves.toEqual(
      str,
    );
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    const str = 'hello';
    await efs.writeFile(`file`, str);
    await efs.chmod(`file`, 0o200);
    await expectError(efs.access(`file`, vfs.constants.X_OK), errno.EACCES);
    await efs.writeFile(`file`, str);
    await expectError(efs.open(`file`, 'r'), errno.EACCES);
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    const str = 'hello';
    await efs.writeFile(`file`, str);
    await efs.chmod(`file`, 0o300);
    await efs.access(`file`, vfs.constants.X_OK);
    await efs.writeFile(`file`, str);
    await expectError(efs.open(`file`, 'r'), errno.EACCES);
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.writeFile(`file`, 'hello');
    await efs.chmod(`file`, 0o100);
    await efs.access(`file`, vfs.constants.X_OK);
    await expectError(efs.open(`file`, 'w'), errno.EACCES);
    await expectError(efs.open(`file`, 'r'), errno.EACCES);
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.mkdir(`---`);
    await efs.chmod(`---`, 0o000);
    const stat = (await efs.stat(`---`)) as vfs.Stat;
    expect(stat.isDirectory()).toStrictEqual(true);
    await expectError(efs.writeFile(`---/a`, 'hello'), errno.EACCES);
    await expectError(efs.chdir(`---`), errno.EACCES);
    await expectError(efs.readdir(`---`), errno.EACCES);
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.mkdir(`r--`);
    await efs.writeFile(`r--/a`, 'hello');
    await efs.chmod(`r--`, 0o400);
    await expectError(efs.writeFile(`r--/b`, 'hello'), errno.EACCES);
    await expectError(efs.chdir(`r--`), errno.EACCES);
    await expect(efs.readdir(`r--`)).resolves.toContain('a');
    // you can always change metadata even without write permissions
    await efs.utimes(`r--`, new Date(), new Date());
    await expectError(efs.stat(`r--/a`), errno.EACCES);
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.mkdir(`rw-`);
    await efs.writeFile(`rw-/a`, 'hello');
    await efs.chmod(`rw-`, 0o600);
    // you cannot write into a file
    await expectError(efs.writeFile(`rw-/a`, 'world'), errno.EACCES);
    // you cannot create a new file
    await expectError(efs.writeFile(`rw-/b`, 'hello'), errno.EACCES);
    // you cannot remove files
    await expectError(efs.unlink(`rw-/a`), errno.EACCES);
    await expectError(efs.chdir(`rw-`), errno.EACCES);
    await expect(efs.readdir(`rw-`)).resolves.toContain('a');
    await efs.utimes(`rw-`, new Date(), new Date());
    await expectError(efs.stat(`rw-/a`), errno.EACCES);
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.mkdir(`rwx`);
    await efs.chmod(`rwx`, 0o700);
    const str = 'abc';
    await efs.writeFile(`rwx/a`, str);
    await expect(efs.readFile(`rwx/a`, { encoding: 'utf8' })).resolves.toEqual(
      str,
    );
    await expect(efs.readdir(`rwx`)).resolves.toContain('a');
    await efs.chdir('rwx');
    const stat = (await efs.stat(`a`)) as vfs.Stat;
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.mkdir(`r-x`);
    await efs.mkdir(`r-x/dir`);
    await efs.writeFile(`r-x/a`, 'hello');
    await efs.chmod(`r-x`, 0o500);
    const str = 'world';
    // you can write to the file
    await efs.writeFile(`r-x/a`, str);
    // you cannot create new files
    await expectError(efs.writeFile(`r-x/b`, str), errno.EACCES);
    // you can read the directory
    await expect(efs.readdir(`r-x`)).resolves.toContain('a');
    await expect(efs.readdir(`r-x`)).resolves.toContain('dir');
    // you can read the file
    await expect(efs.readFile(`r-x/a`, { encoding: 'utf8' })).resolves.toEqual(
      str,
    );
    // you can traverse into the directory
    await efs.chdir('r-x');
    const stat = (await efs.stat(`dir`)) as vfs.Stat;
    expect(stat.isDirectory()).toStrictEqual(true);
    // you cannot delete the file
    await expectError(efs.unlink(`./a`), errno.EACCES);
    // cannot delete the directory
    await expectError(efs.rmdir(`dir`), errno.EACCES);
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.mkdir(`-w-`);
    await efs.chmod(`-w-`, 0o000);
    await expectError(efs.writeFile(`-w-/a`, 'hello'), errno.EACCES);
    await expectError(efs.chdir(`-w-`), errno.EACCES);
    await expectError(efs.readdir(`-w-`), errno.EACCES);
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.mkdir(`-wx`);
    await efs.chmod(`-wx`, 0o300);
    const str = 'hello';
    await efs.writeFile(`-wx/a`, str);
    await expect(efs.readFile(`-wx/a`, { encoding: 'utf8' })).resolves.toEqual(
      str,
    );
    await efs.unlink(`-wx/a`);
    await efs.chdir('-wx');
    await efs.mkdir(`./dir`);
    await expectError(efs.readdir(`.`), errno.EACCES);
    const stat = (await efs.stat(`./dir`)) as vfs.Stat;
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    await efs.mkdir(`--x`);
    const str = 'hello';
    await efs.writeFile(`--x/a`, str);
    await efs.chmod(`--x`, 0o100);
    await expectError(efs.writeFile(`--x/b`, 'world'), errno.EACCES);
    await efs.chdir('--x');
    await expectError(efs.unlink(`./a`), errno.EACCES);
    await expectError(efs.readdir(`.`), errno.EACCES);
    await expect(efs.readFile(`./a`, { encoding: 'utf8' })).resolves.toEqual(
      str,
    );
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
    await efs.mkdirp('/home/1000');
    await efs.chown('/home/1000', 1000, 1000);
    await efs.chdir('/home/1000');
    efs.uid = 1000;
    efs.gid = 1000;
    const str = 'hello';
    await efs.writeFile(`file`, str);
    await efs.chmod(`file`, 0o777);
    const fd = await efs.open(`file`, 'r+');
    await efs.chmod(`file`, 0o000);
    await expect(efs.readFile(fd, { encoding: 'utf8' })).resolves.toEqual(str);
    const str2 = 'world';
    await efs.writeFile(fd, str2);
    await efs.lseek(fd, 0);
    await expect(efs.readFile(fd, { encoding: 'utf8' })).resolves.toBe(str2);
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
    let stat = (await efs.stat('/dir')) as vfs.Stat;
    expect(stat.uid).toBe(1000);
    expect(stat.gid).toBe(2000);
    stat = (await efs.stat('/dir/a')) as vfs.Stat;
    expect(stat.uid).toBe(1000);
    expect(stat.gid).toBe(2000);
    stat = (await efs.stat('/dir/b')) as vfs.Stat;
    expect(stat.uid).toBe(1000);
    expect(stat.gid).toBe(2000);
    await efs.writeFile('/file', 'hello world');
    await efs.chownr('/file', 1000, 2000);
    stat = (await efs.stat('/file')) as vfs.Stat;
    expect(stat.uid).toBe(1000);
    expect(stat.gid).toBe(2000);
  });
  test('chown can change groups without any problem because we do not have a user group hierarchy', async () => {
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
    await efs.chown('file', 1000, 2000);
  });
  test('--x-w-r-- do not provide read write and execute to the user due to permission staging', async () => {
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
    await efs.writeFile('file', 'hello');
    await efs.mkdir('dir');
    await efs.chmod('file', 0o124);
    await efs.chmod('dir', 0o124);
    await expectError(efs.access('file', (vfs.constants.R_OK | vfs.constants.W_OK)), errno.EACCES);
    await expectError(efs.access('dir', (vfs.constants.R_OK | vfs.constants.W_OK)), errno.EACCES);
    await efs.access('file', fs.constants.X_OK);
    await efs.access('dir', fs.constants.X_OK);
  });
});
