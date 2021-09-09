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
  createFile,
  expectError,
  FileTypes,
  setId,
  sleep,
  supportedTypes,
} from './utils';
import path from 'path';

describe('EncryptedFS Files', () => {
  const logger = new Logger('EncryptedFS Files', LogLevel.WARN, [
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
    const stat = (await efs.stat(`test`)) as vfs.Stat;
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
    const test = await efs.readdir('.');
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
    const test = await efs.readdir('.');
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
    await expect(
      efs.readFile(`hello-world`, { encoding: 'utf8' }),
    ).resolves.toBe('Hello World');
    await efs.writeFile(`a`, 'Test', { encoding: 'utf-8' });
    await expect(efs.readFile(`a`, { encoding: 'utf-8' })).resolves.toBe(
      'Test',
    );
    const stat = (await efs.stat(`a`)) as vfs.Stat;
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
    expect(stat.isDirectory()).toBe(false);
    await efs.writeFile(`b`, 'Test', { encoding: 'utf8' });
    await expect(efs.readFile(`b`, { encoding: 'utf-8' })).resolves.toEqual(
      'Test',
    );
    await expectError(efs.readFile(`other-file`), errno.ENOENT);
    await expectError(
      efs.readFile(`other-file`, { encoding: 'utf8' }),
      errno.ENOENT,
    );
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
  test('writeFile calling styles', async () => {
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
    await efs.writeFile(fd, str, {
      encoding: 'utf8',
      mode: 0o666,
      flag: 'w',
    });
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
    await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toBe(
      'aaa',
    );
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
    await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toBe(
      'aaa',
    );
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
    await expect(
      efs.readFile('/fdtest', { encoding: 'utf8' }),
    ).resolves.toEqual('abcdefghi');
    await efs.close(fd);
    // reading with position null does move the fd
    await efs.writeFile('/fdtest', 'abcdef');
    fd = await efs.open('/fdtest', 'r+');
    bytesRead = await efs.read(fd, buf, 0, buf.length);
    expect(bytesRead).toBe(3);
    await efs.write(fd, 'ghi');
    await expect(efs.readFile('/fdtest', { encoding: 'utf8' })).resolves.toBe(
      'abcghi',
    );
    await efs.close(fd);
    // reading with position 0 doesn't move the fd from the start
    await efs.writeFile('/fdtest', 'abcdef');
    fd = await efs.open('/fdtest', 'r+');
    buf = Buffer.alloc(3);
    bytesRead = await efs.read(fd, buf, 0, buf.length, 0);
    expect(bytesRead).toBe(3);
    await efs.write(fd, 'ghi');
    await expect(
      efs.readFile('/fdtest', { encoding: 'utf8' }),
    ).resolves.toEqual('ghidef');
    await efs.close(fd);
    // reading with position 3 doesn't move the fd from the start
    await efs.writeFile('/fdtest', 'abcdef');
    fd = await efs.open('/fdtest', 'r+');
    buf = Buffer.alloc(3);
    bytesRead = await efs.read(fd, buf, 0, buf.length, 3);
    expect(bytesRead).toBe(3);
    await efs.write(fd, 'ghi');
    await expect(
      efs.readFile('/fdtest', { encoding: 'utf8' }),
    ).resolves.toEqual('ghidef');
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
    await expect(
      efs.readFile('./testy', { encoding: 'utf8' }),
    ).resolves.toEqual('ghidefjkl');
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
    await expect(efs.readFile(fd, { encoding: 'utf-8' })).resolves.toEqual(
      'starting',
    );
    await efs.write(fd, 'ending');
    await expect(
      efs.readFile('/fdtest', { encoding: 'utf-8' }),
    ).resolves.toEqual('startingending');
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
    await expect(
      efs.readFile('/fdtest', { encoding: 'utf8' }),
    ).resolves.toEqual('bac');
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
    await expect(
      efs.readFile('/fdtest', { encoding: 'utf8' }),
    ).resolves.toEqual('abcdefghi');
    await efs.close(fd);
    // even if read moves to to position 3, write will jump the position to the end
    await efs.writeFile('/fdtest', 'abcdef');
    fd = await efs.open('/fdtest', 'a+');
    buf = Buffer.alloc(3);
    bytesRead = await efs.read(fd, buf, 0, buf.length);
    expect(bytesRead).toBe(3);
    expect(buf).toEqual(Buffer.from('abc'));
    await efs.write(fd, 'ghi');
    await expect(
      efs.readFile('/fdtest', { encoding: 'utf8' }),
    ).resolves.toEqual('abcdefghi');
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
    await expectError(efs.access('/test1', vfs.constants.W_OK), errno.EACCES);
    await efs.access('/test2', vfs.constants.R_OK);
    await expectError(efs.access('/test1', vfs.constants.W_OK), errno.EACCES);
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
    const stat = (await efs.stat('allocate')) as vfs.Stat;
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
    const stat = (await efs.stat(`allocate`)) as vfs.Stat;
    const offset = 0;
    const length = 8000;
    await efs.fallocate(fd, offset, length);
    const stat2 = (await efs.stat(`allocate`)) as vfs.Stat;
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
    const stat = (await efs.stat(`test`)) as vfs.Stat;
    await efs.truncate(`test`, str.length);
    const stat2 = (await efs.stat(`test`)) as vfs.Stat;
    expect(stat.mtime < stat2.mtime && stat.ctime < stat2.ctime).toEqual(true);
    const fd = await efs.open(`test`, 'r+');
    await efs.ftruncate(fd, str.length);
    const stat3 = (await efs.stat(`test`)) as vfs.Stat;
    expect(stat2.mtime < stat3.mtime && stat2.ctime < stat3.ctime).toEqual(
      true,
    );
    await efs.ftruncate(fd, str.length);
    const stat4 = (await efs.stat(`test`)) as vfs.Stat;
    expect(stat3.mtime < stat4.mtime && stat3.ctime < stat4.ctime).toEqual(
      true,
    );
    await efs.close(fd);
  });
  test('ftruncate truncates the fd position', async () => {
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
    await efs.write(fd, 'abcdef');
    await efs.ftruncate(fd, 3);
    await efs.write(fd, 'ghi');
    expect(await efs.readFile('/fdtest', { encoding: 'utf8' })).toEqual(
      'abcghi',
    );
    await efs.close(fd);
    await efs.writeFile('/fdtest', 'abcdef');
    fd = await efs.open('/fdtest', 'r+');
    const buf = Buffer.allocUnsafe(3);
    await efs.read(fd, buf, 0, buf.length);
    await efs.ftruncate(fd, 4);
    await efs.read(fd, buf, 0, buf.length);
    expect(buf).toEqual(Buffer.from('dbc'));
    await efs.close(fd);
  });
  test('Uint8Array data support', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    const buf = Buffer.from('abc');
    const array = new Uint8Array(buf);
    await efs.writeFile('/a', array);
    await expect(efs.readFile('/a')).resolves.toEqual(buf);
    const fd = await efs.open('/a', 'r+');
    await efs.write(fd, array);
    await efs.lseek(fd, 0);
    const array2 = new Uint8Array(array.length);
    await efs.read(fd, array2, 0, array2.length);
    expect(array2).toEqual(array);
    await efs.close(fd);
  });
  test('URL path support', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    let url;
    url = new URL('file:///file');
    const str = 'Hello World';
    await efs.writeFile(url, str);
    await expect(efs.readFile(url, { encoding: 'utf8' })).resolves.toBe(str);
    const fd = await efs.open(url, 'a+');
    const str2 = 'abc';
    await efs.write(fd, str2);
    const buf = Buffer.allocUnsafe(str.length + str2.length);
    await efs.lseek(fd, 0);
    await efs.read(fd, buf, 0, buf.length);
    expect(buf).toEqual(Buffer.from(str + str2));
    url = new URL('file://hostname/file');
    await expect(efs.open(url, 'w')).rejects.toThrow(
      'ERR_INVALID_FILE_URL_HOST',
    );
    await efs.close(fd);
  });

  describe('open', () => {
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
    describe('opens (and eventually creates) a file (00)', () => {
      test.skip("If O_CREAT is specified and the file doesn't exist", async () => {
      //   // # POSIX: (If O_CREAT is specified and the file doesn't exist) [...] the access
      //   // # permission bits of the file mode shall be set to the value of the third
      //   // # argument taken as type mode_t modified as follows: a bitwise AND is performed
      //   // # on the file-mode bits and the corresponding bits in the complement of the
      //   // # process' file mode creation mask. Thus, all bits in the file mode whose
      //   // # corresponding bit in the file mode creation mask is set are cleared.
      const modeCheck = (vfs.constants.S_IRWXU | vfs.constants.S_IRWXG | vfs.constants.S_IRWXO);
      let fd;
        fd = await efs.open(n0, (vfs.constants.O_CREAT | vfs.constants.O_WRONLY), dp);
        expect((await efs.lstat(n0)).mode & modeCheck).toEqual(dp & ~0o022);
        await efs.unlink(n0);
        await efs.close(fd);

        fd = await efs.open(n0, (vfs.constants.O_CREAT | vfs.constants.O_WRONLY), 0o0151);
        expect((await efs.lstat(n0)).mode & modeCheck).toEqual(0o0151 & ~0o022);
        await efs.unlink(n0);
        await efs.close(fd);

        efs.uid = 0o077
        fd = await efs.open(n0, (vfs.constants.O_CREAT | vfs.constants.O_WRONLY), 0o0151);
        expect((await efs.lstat(n0)).mode & modeCheck).toEqual(0o0151 & ~0o022);
        await efs.unlink(n0);
        await efs.close(fd);
      })
      test("Update parent directory ctime/mtime if file didn't exist.", async () => {
        const PUT = path.join(n1, n0);
        await efs.mkdir(n1, dp);
        const time = (await efs.stat(n1)).ctime.getTime();
        await sleep(10);
        const fd = await efs.open(PUT, 'w', 0o0644);
        const atime = (await efs.stat(PUT)).atime.getTime();
        expect(time).toBeLessThan(atime);
        const mtime = (await efs.stat(PUT)).mtime.getTime();
        expect(time).toBeLessThan(mtime);
        const ctime = (await efs.stat(PUT)).ctime.getTime();
        expect(time).toBeLessThan(ctime);
        const mtime2 = (await efs.stat(n1)).mtime.getTime();
        expect(time).toBeLessThan(mtime2);
        const ctime2 = (await efs.stat(n1)).ctime.getTime();
        expect(time).toBeLessThan(ctime2);
      });
      test("Don't update parent directory ctime/mtime if file existed.", async () => {
        const PUT = path.join(n1, n0);
        await efs.mkdir(n1, dp);

        await createFile(efs, 'regular', PUT);
        const dmtime = (await efs.stat(n1)).mtime.getTime();
        const dctime = (await efs.stat(n1)).ctime.getTime();
        await sleep(10);
        let fd = await efs.open(PUT, vfs.constants.O_CREAT | vfs.constants.O_RDONLY, 0o0644);
        const mtime = (await efs.stat(n1)).mtime.getTime();
        expect(dmtime).toEqual(mtime);
        const ctime = (await efs.stat(n1)).ctime.getTime();
        expect(dctime).toEqual(ctime);
        await efs.unlink(PUT);
        await efs.close(fd);
      });
    });
    describe('returns ENOTDIR if a component of the path prefix is not a directory (01)', () => {
      test.each(['regular', 'block', 'char'])('Type: %s', async (type) => {
        const PUT = path.join(n1, 'test');
        await createFile(efs, type as FileTypes, n1);
        await expectError(efs.open(PUT, 'r'), errno.ENOTDIR);
        await expectError(efs.open(PUT, 'w', 0o0644), errno.ENOTDIR);
      });
    });
    test('returns ENOENT if a component of the path name that must exist does not exist or O_CREAT is not set and the named file does not exist (04)', async () => {
      await efs.mkdir(n0, dp);
      await expectError(
        efs.open(path.join(n0, n1, 'test'), vfs.constants.O_CREAT, 0o0644),
        errno.ENOENT,
      );
      await expectError(
        efs.open(path.join(n0, n1, 'test'), vfs.constants.O_RDONLY),
        errno.ENOENT,
      );
    });
    test('returns EACCES when search permission is denied for a component of the path prefix (05)', async () => {
      await efs.mkdir(n1, dp);
      await efs.chown(n1, tuid, tuid);
      setId(efs, tuid);
      await createFile(efs, 'regular', path.join(n1, n2));
      let fd = await efs.open(path.join(n1, n2), vfs.constants.O_RDONLY);
      await efs.close(fd);
      await efs.chmod(n1, 0o0644);
      await expectError(
        efs.open(path.join(n1, n2), vfs.constants.O_RDONLY),
        errno.EACCES,
      );
      await efs.chmod(n1, 0o0755);
      fd = await efs.open(path.join(n1, n2), vfs.constants.O_RDONLY);
      await efs.close(fd);
    });
    describe('returns EACCES when the required permissions (for reading and/or writing) are denied for the given flags (06)', () => {
      const oCon = vfs.constants;
      test.skip('regular file', async () => {
        await efs.mkdir(n0, dp);
        // await efs.chown(n0, tuid, tuid);
        const PUT = path.join(n0, n1);
        // setId(efs, tuid);
        await createFile(efs, 'regular', PUT);
        // await efs.chown(PUT, tuid, tuid);

        let fd;
        let modes = [0o0600, 0o0060, 0o0006];
        for (const mode of modes) {
          await efs.chmod(PUT, mode);
          fd = await efs.open(PUT, oCon.O_RDONLY);
          await efs.close(fd);
          fd = await efs.open(PUT, oCon.O_WRONLY);
          await efs.close(fd);
          fd = await efs.open(PUT, oCon.O_RDWR);
          await efs.close(fd);
        }
        modes = [0o0477, 0o0747, 0o0774];
        for (const mode of modes) {
          await efs.chmod(PUT, mode);
          fd = await efs.open(PUT, oCon.O_RDONLY);
          await efs.close(fd);
          await expectError(efs.open(PUT, oCon.O_WRONLY), errno.EACCES);
          await expectError(efs.open(PUT, oCon.O_RDWR), errno.EACCES);
        }

        modes = [0o0277, 0o0727, 0o0772];
        for (const mode of modes) {
          await efs.chmod(PUT, mode);
          await expectError(efs.open(PUT, oCon.O_RDONLY), errno.EACCES);
          fd = await efs.open(PUT, oCon.O_WRONLY);
          await efs.close(fd);
          await expectError(efs.open(PUT, oCon.O_RDWR), errno.EACCES);
        }

        modes = [0o0177, 0o0717, 0o0771];
        for (const mode of modes) {
          await efs.chmod(PUT, mode);
          await expectError(efs.open(PUT, oCon.O_RDONLY), errno.EACCES);
          await expectError(efs.open(PUT, oCon.O_WRONLY), errno.EACCES);
          await expectError(efs.open(PUT, oCon.O_RDWR), errno.EACCES);
        }

        modes = [0o0077, 0o0707, 0o0770];
        for (const mode of modes) {
          await efs.chmod(PUT, mode);
          await expectError(efs.open(PUT, oCon.O_RDONLY), errno.EACCES);
          await expectError(efs.open(PUT, oCon.O_WRONLY), errno.EACCES);
          await expectError(efs.open(PUT, oCon.O_RDWR), errno.EACCES);
        }
      });
      test.skip('directory', async () => {
        await efs.mkdir(n0, dp);
        // await efs.chown(n0, tuid, tuid);
        const PUT = path.join(n0, n1);
        await efs.mkdir(PUT, dp);

        let fd;
        let modes = [0o0600, 0o0060, 0o0006];
        for (const mode of modes) {
          await efs.chmod(PUT, mode);
          fd = await efs.open(PUT, oCon.O_RDONLY);
          await efs.close(fd);
        }

        modes = [0o0477, 0o0747, 0o0774];
        for (const mode of modes) {
          await efs.chmod(PUT, mode);
          fd = await efs.open(PUT, oCon.O_RDONLY);
          await efs.close(fd);
        }

        modes = [0o0277, 0o0727, 0o0772];
        for (const mode of modes) {
          await efs.chmod(PUT, mode);
          await expectError(efs.open(PUT, oCon.O_RDONLY), errno.EACCES);
        }

        modes = [0o0177, 0o0717, 0o0771];
        for (const mode of modes) {
          await efs.chmod(PUT, mode);
          await expectError(efs.open(PUT, oCon.O_RDONLY), errno.EACCES);
        }

        modes = [0o0077, 0o0707, 0o0770];
        for (const mode of modes) {
          await efs.chmod(PUT, mode);
          await expectError(efs.open(PUT, oCon.O_RDONLY), errno.EACCES);
        }
      });
    });
    test.skip('returns EACCES when O_TRUNC is specified and write permission is denied (07)', async () => {
      const message = 'The Quick Brown Fox Jumped Over The Lazy Dog';
      await efs.writeFile(n1, message, { mode: 0o0644 });

      const modes = [
        0o0477,
        0o0747,
        0o0774,
        0o0177,
        0o0717,
        0o0771,
        0o0077,
        0o0707,
        0o0770,
      ];
      for (const mode of modes) {
        await efs.chmod(n1, mode);
        const flags = vfs.constants.O_RDONLY | vfs.constants.O_TRUNC;
        await expectError(efs.open(n1, flags), errno.EACCES);
      }
    });
    test('returns ELOOP if too many symbolic links were encountered in translating the pathname (12)', async () => {
      await efs.symlink(n0, n1);
      await efs.symlink(n1, n0);
      await expectError(
        efs.open(path.join(n0, 'test'), vfs.constants.O_RDONLY),
        errno.ELOOP,
      );
      await expectError(
        efs.open(path.join(n1, 'test'), vfs.constants.O_RDONLY),
        errno.ELOOP,
      );
    });
    test('returns EISDIR when trying to open a directory for writing (13)', async () => {
      const flags = vfs.constants;
      await efs.mkdir(n0, dp);
      const fd = await efs.open(n0, flags.O_RDONLY);
      await efs.close(fd);
      await expectError(efs.open(n0, flags.O_WRONLY), errno.EISDIR);
      await expectError(efs.open(n0, flags.O_RDWR), errno.EISDIR);
      await expectError(
        efs.open(n0, flags.O_RDONLY | flags.O_TRUNC),
        errno.EISDIR,
      );
      await expectError(
        efs.open(n0, flags.O_WRONLY | flags.O_TRUNC),
        errno.EISDIR,
      );
      await expectError(
        efs.open(n0, flags.O_RDWR | flags.O_TRUNC),
        errno.EISDIR,
      );
    });
    test('returns ELOOP when O_NOFOLLOW was specified and the target is a symbolic link (16)', async () => {
      await efs.symlink(n0, n1);
      const flags = vfs.constants;
      const nf = flags.O_NOFOLLOW;
      await expectError(
        efs.open(n1, flags.O_RDONLY | flags.O_CREAT | nf),
        errno.ELOOP,
      );
      await expectError(efs.open(n1, flags.O_RDONLY | nf), errno.ELOOP);
      await expectError(efs.open(n1, flags.O_WRONLY | nf), errno.ELOOP);
      await expectError(efs.open(n1, flags.O_RDWR | nf), errno.ELOOP);
    });
    describe('returns EEXIST when O_CREAT and O_EXCL were specified and the file exists (22)', () => {
      const flags = vfs.constants;
      test.each(supportedTypes)('Type: %s', async (type) => {
        await efs.mkdir('test');
        await createFile(efs, type, n0);
        await expectError(
          efs.open(n0, flags.O_CREAT | flags.O_EXCL, 0o0644),
          errno.EEXIST,
        );
      });
    });
  });
});
