import path from 'path';
import { expectError, sleep } from './utils';
import {
  EncryptedFS,
  constants,
  errno,
  DB,
  INodeManager,
  DeviceManager,
} from '@';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as utils from '@/utils';
import fs from 'fs';
import pathNode from 'path';
import os from 'os';
import { FdIndex } from '@/fd/types';
import { WriteStream } from '@/streams';

describe('EncryptedFS Concurrency', () => {
  const logger = new Logger('EncryptedFS Directories', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let dbPath: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
  let iNodeMgr: INodeManager;
  const devMgr = new DeviceManager();
  let efs: EncryptedFS;
  const flags = constants;
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
  test('Renaming a directory at the same time with two different calls', async () => {
    await efs.mkdir('test');
    try {
      await Promise.all([
        efs.rename('test', 'one'),
        efs.rename('test', 'two'),
        efs.rename('test', 'three'),
        efs.rename('test', 'four'),
        efs.rename('test', 'five'),
        efs.rename('test', 'six'),
      ]);
    } catch (err) {
      // Do nothing
    }

    // Right now only the first rename works. the rest fail. this is expected.
    expect(await efs.readdir('.')).toContain('one');
  });
  test('Reading a directory while adding/removing entries in the directory', async () => {
    await efs.mkdir('dir');
    const file1 = path.join('dir', 'file1');

    const results1 = await Promise.all([
      efs.writeFile(file1, 'test1'),
      efs.readdir('dir'),
    ]);
    // Readdir seems to return the directory before the changes happen.
    expect(results1[1]).not.toContain('file1');
    expect(await efs.readdir('dir')).toContain('file1');

    const results2 = await Promise.all([efs.unlink(file1), efs.readdir('dir')]);
    // Readdir seems to return the directory before the changes happen.
    expect(results2[1]).toContain('file1');
    expect(await efs.readdir('dir')).not.toContain('file1');
  });
  test('Reading a directory while removing the directory', async () => {
    await efs.mkdir('dir');

    const results1 = await Promise.all([efs.readdir('dir'), efs.rmdir('dir')]);
    // Readdir seems to return the directory before the changes happen.
    expect(results1[0]).toEqual([]);
    await expectError(efs.readdir('dir'), errno.ENOENT);

    // If after the rmdir readdir just fails.
    await efs.mkdir('dir');
    await expectError(
      Promise.all([efs.rmdir('dir'), efs.readdir('dir')]),
      errno.ENOTDIR,
    );
  });
  test('Reading a directory while renaming entries', async () => {
    await efs.mkdir('dir');
    await efs.writeFile(path.join('dir', 'file1'));

    const results1 = await Promise.all([
      efs.readdir('dir'),
      efs.rename(path.join('dir', 'file1'), path.join('dir', 'file2')),
    ]);
    // Readdir seems to return the directory before the changes happen.
    expect(results1[0]).toContain('file1');
    expect(await efs.readdir('dir')).toContain('file2');

    const results2 = await Promise.all([
      efs.rename(path.join('dir', 'file2'), path.join('dir', 'file1')),
      efs.readdir('dir'),
    ]);
    // Readdir seems to return the directory before the changes happen.
    expect(results2[1]).toContain('file2');
    expect(await efs.readdir('dir')).toContain('file1');
  });
  describe('concurrent file writes', () => {
    test('10 short writes with efs.writeFile.', async () => {
      const contents = [
        'one',
        'two',
        'three',
        'four',
        'five',
        'six',
        'seven',
        'eight',
        'nine',
        'ten',
      ];
      // Here we want to write to a file at the same time and sus out the behaviour.
      const promises: Array<any> = [];
      for (const content of contents) {
        promises.push(efs.writeFile('test', content));
      }
      await Promise.all(promises);
    });
    test('10 long writes with efs.writeFile.', async () => {
      const blockSize = 4096;
      const blocks = 100;
      const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
      let divisor = 0;
      const contents = letters.map((letter) => {
        divisor++;
        return letter.repeat((blockSize * blocks) / divisor);
      });
      const promises: Array<any> = [];
      for (const content of contents) {
        promises.push(efs.writeFile('test', content, {}));
      }
      await Promise.all(promises);
    });
    test('10 short writes with efs.write.', async () => {
      const contents = [
        'one',
        'two',
        'three',
        'four',
        'five',
        'six',
        'seven',
        'eight',
        'nine',
        'ten',
      ];
      // Here we want to write to a file at the same time and sus out the behaviour.
      const fds: Array<FdIndex> = [];
      for (let i = 0; i < 10; i++) {
        fds.push(await efs.open('test', flags.O_RDWR | flags.O_CREAT));
      }
      const promises: Array<any> = [];
      for (let i = 0; i < 10; i++) {
        promises.push(efs.write(fds[i], contents[i]));
      }
      await Promise.all(promises);
    });
    test('10 long writes with efs.write.', async () => {
      const blockSize = 4096;
      const blocks = 100;
      const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
      let divisor = 0;
      const contents = letters.map((letter) => {
        divisor++;
        return letter.repeat((blockSize * blocks) / divisor);
      });
      let fds: Array<FdIndex> = [];
      for (let i = 0; i < 10; i++) {
        fds.push(await efs.open('test', flags.O_RDWR | flags.O_CREAT));
      }
      let promises: Array<any> = [];
      for (let i = 0; i < 10; i++) {
        promises.push(efs.write(fds[i], contents[i]));
      }
      await Promise.all(promises);
      const fileContent = (await efs.readFile('test')).toString();

      for (const letter of letters) {
        expect(fileContent).toContain(letter);
      }

      //Now reverse order.
      await efs.unlink('test');
      for (const fd of fds) {
        await efs.close(fd);
      }
      fds = [];
      for (let i = 9; i >= 0; i--) {
        fds.push(await efs.open('test', flags.O_RDWR | flags.O_CREAT));
      }
      promises = [];
      for (let i = 9; i >= 0; i--) {
        promises.push(efs.write(fds[i], contents[i]));
      }
      await Promise.all(promises);
      const fileContent2 = (await efs.readFile('test')).toString();

      expect(fileContent2).toContain('A');
    });
  });
  describe('Allocating/truncating a file while writing (stream or fd)', () => {
    test('Allocating while writing to fd', async () => {
      const fd = await efs.open('file', flags.O_WRONLY | flags.O_CREAT);

      const content = 'A'.repeat(4096 * 2);

      await Promise.all([
        efs.write(fd, Buffer.from(content)),
        efs.fallocate(fd, 0, 4096 * 3),
      ]);

      // Both operations complete, order makes no diference.
      const fileContents = await efs.readFile('file');
      expect(fileContents.length).toBeGreaterThan(4096 * 2);
      expect(fileContents.toString()).toContain('A');
      expect(fileContents).toContain(0x00);
    });
    test('Truncating while writing to fd', async () => {
      const fd1 = await efs.open('file', flags.O_WRONLY | flags.O_CREAT);

      const content = 'A'.repeat(4096 * 2);

      await Promise.all([
        efs.write(fd1, Buffer.from(content)),
        efs.ftruncate(fd1, 4096),
      ]);

      // Both operations complete, order makes no difference. Truncate doesn't do anything?
      const fileContents1 = await efs.readFile('file');
      expect(fileContents1.length).toBe(4096 * 2);
      expect(fileContents1.toString()).toContain('A');
      expect(fileContents1).not.toContain(0x00);

      await efs.unlink('file');

      const fd2 = await efs.open('file', flags.O_WRONLY | flags.O_CREAT);

      await Promise.all([
        efs.ftruncate(fd2, 4096),
        efs.write(fd2, Buffer.from(content)),
      ]);

      // Both operations complete, order makes no difference. Truncate doesn't do anything?
      const fileContents2 = await efs.readFile('file');
      expect(fileContents2.length).toBe(4096 * 2);
      expect(fileContents2.toString()).toContain('A');
      expect(fileContents2).not.toContain(0x00);
    });
    test('Allocating while writing to stream', async () => {
      await efs.writeFile('file', '');
      const writeStream = await efs.createWriteStream('file');
      const content = 'A'.repeat(4096);
      const fd = await efs.open('file', 'w');

      await Promise.all([
        new Promise((res) => {
          writeStream.write(content, () => {
            res(null);
          });
        }),
        efs.fallocate(fd, 0, 4096 * 2),
      ]);
      await new Promise((res) => {
        writeStream.end(() => {
          res(null);
        });
      });

      // Both operations complete, order makes no difference.
      const fileContents = await efs.readFile('file');
      expect(fileContents.length).toEqual(4096 * 2);
      expect(fileContents.toString()).toContain('A');
      expect(fileContents).toContain(0x00);
    });
    test('Truncating while writing to stream', async () => {
      await efs.writeFile('file', '');
      const writeStream = await efs.createWriteStream('file');
      const content = 'A'.repeat(4096 * 2);
      const promise1 = new Promise((res) => {
        writeStream.write(content, () => {
          res(null);
        });
      });

      await Promise.all([promise1, efs.truncate('file', 4096)]);
      await new Promise((res) => {
        writeStream.end(() => {
          res(null);
        });
      });

      // Both operations complete, order makes no difference. Truncate doesn't do anything?
      const fileContents = await efs.readFile('file');
      expect(fileContents.length).toEqual(4096 * 2);
      expect(fileContents.toString()).toContain('A');
      expect(fileContents).not.toContain(0x00);
    });
  });
  test('File metadata changes while reading/writing a file.', async () => {
    const fd1 = await efs.promises.open('file', flags.O_WRONLY | flags.O_CREAT);
    const content = 'A'.repeat(2);
    await Promise.all([
      efs.promises.writeFile(fd1, Buffer.from(content)),
      efs.promises.utimes('file', 0, 0),
    ]);
    let stat = await efs.promises.stat('file');
    expect(stat.atime.getMilliseconds()).toBe(0);
    expect(stat.mtime.getMilliseconds()).toBe(0);
    await efs.close(fd1);
    await efs.unlink('file');

    const fd2 = await efs.promises.open('file', flags.O_WRONLY | flags.O_CREAT);
    await Promise.all([
      efs.promises.utimes('file', 0, 0),
      efs.promises.writeFile(fd2, Buffer.from(content)),
    ]);
    stat = await efs.promises.stat('file');
    expect(stat.atime.getMilliseconds()).toBe(0);
    expect(stat.mtime.getMilliseconds()).toBeGreaterThan(0);
    await efs.close(fd2);
    // Await efs.writeFile('file', '');
    // let stat0 = await efs.stat('file');
    // const birthtime0 = stat0.birthtime.getTime();
    // const atime0 = stat0.atime.getTime();
    // const mtime0 = stat0.mtime.getTime();
    // const ctime0 = stat0.ctime.getTime();

    // await sleep(50);
    // // nothing updates when opened.
    // const fd = await efs.open('file', flags.O_RDWR)
    // let stat1 = await efs.stat('file');
    // const birthtime1 = stat1.birthtime.getTime();
    // const atime1 = stat1.atime.getTime();
    // const mtime1 = stat1.mtime.getTime();
    // const ctime1 = stat1.ctime.getTime();
    // expect(birthtime1).toEqual(birthtime0);
    // expect(atime1).toEqual(atime0);
    // expect(ctime1).toEqual(ctime0);
    // expect(mtime1).toEqual(mtime0);

    // await sleep(50);
    // //atime updates when read.
    // const buf = Buffer.alloc(20, 0);
    // await efs.read(fd, buf);
    // let stat2 = await efs.stat('file');
    // const birthtime2 = stat2.birthtime.getTime();
    // const atime2 = stat2.atime.getTime();
    // const mtime2 = stat2.mtime.getTime();
    // const ctime2 = stat2.ctime.getTime();
    // expect(birthtime2).toEqual(birthtime1);
    // expect(atime2).toBeGreaterThan(atime1);
    // expect(ctime2).toEqual(ctime1);
    // expect(mtime2).toEqual(mtime1);

    // await sleep(50);
    // //ctime updates when permissions change.
    // await efs.fchown(fd, 10, 10);
    // await efs.fchown(fd, 0, 0);
    // let stat3 = await efs.stat('file');
    // const birthtime3 = stat3.birthtime.getTime();
    // const atime3 = stat3.atime.getTime();
    // const mtime3 = stat3.mtime.getTime();
    // const ctime3 = stat3.ctime.getTime();
    // expect(birthtime3).toEqual(birthtime2);
    // expect(atime3).toEqual(atime2);
    // // expect(ctime3).toBeGreaterThan(ctime2); // This is not updating!
    // expect(mtime3).toEqual(mtime2);

    // await sleep(50);
    // //mtime updates when written to.
    // await efs.write(fd, Buffer.from('hello!'));
    // let stat4 = await efs.stat('file');
    // const birthtime4 = stat4.birthtime.getTime();
    // const atime4 = stat4.atime.getTime();
    // const mtime4 = stat4.mtime.getTime();
    // const ctime4 = stat4.ctime.getTime();
    // expect(birthtime4).toEqual(birthtime3);
    // expect(atime4).toEqual(atime3);
    // expect(ctime4).toBeGreaterThan(ctime3);
    // expect(mtime4).toBeGreaterThan(mtime3);
  });
  test('Dir metadata changes while reading/writing a file.', async () => {
    const dir = 'directory';
    const PUT = path.join(dir, 'file');
    await efs.mkdir(dir);
    const content = 'A'.repeat(2);
    await Promise.all([
      efs.promises.writeFile(PUT, Buffer.from(content)),
      efs.promises.utimes(dir, 0, 0),
    ]);
    let stat = await efs.promises.stat(dir);
    expect(stat.atime.getMilliseconds()).toBe(0);
    await efs.unlink(PUT);
    await efs.rmdir(dir);
    await efs.mkdir(dir);
    await Promise.all([
      efs.promises.utimes(dir, 0, 0),
      efs.promises.writeFile(PUT, Buffer.from(content)),
    ]);
    stat = await efs.promises.stat(dir);
    expect(stat.atime.getMilliseconds()).toBe(0);
    //   Await efs.writeFile(PUT, '');
    //   let stat0 = await efs.stat(dir);
    //   const birthtime0 = stat0.birthtime.getTime();
    //   const atime0 = stat0.atime.getTime();
    //   const mtime0 = stat0.mtime.getTime();
    //   const ctime0 = stat0.ctime.getTime();

    //   await sleep(50);
    //   // nothing updates when opened.
    //   const fd = await efs.open(PUT, flags.O_RDWR)
    //   let stat1 = await efs.stat(dir);
    //   const birthtime1 = stat1.birthtime.getTime();
    //   const atime1 = stat1.atime.getTime();
    //   const mtime1 = stat1.mtime.getTime();
    //   const ctime1 = stat1.ctime.getTime();
    //   expect(birthtime1).toEqual(birthtime0);
    //   expect(atime1).toEqual(atime0);
    //   expect(ctime1).toEqual(ctime0);
    //   expect(mtime1).toEqual(mtime0);

    //   await sleep(50);
    //   //atime updates when read.
    //   const buf = Buffer.alloc(20, 0);
    //   await efs.read(fd, buf);
    //   let stat2 = await efs.stat(dir);
    //   const birthtime2 = stat2.birthtime.getTime();
    //   const atime2 = stat2.atime.getTime();
    //   const mtime2 = stat2.mtime.getTime();
    //   const ctime2 = stat2.ctime.getTime();
    //   expect(birthtime2).toEqual(birthtime1);
    //   expect(atime2).toBeGreaterThan(atime1);
    //   expect(ctime2).toEqual(ctime1);
    //   expect(mtime2).toEqual(mtime1);

    //   await sleep(50);
    //   //ctime updates when permissions change.
    //   await efs.fchown(fd, 10, 10);
    //   await efs.fchown(fd, 0, 0);
    //   let stat3 = await efs.stat(dir);
    //   const birthtime3 = stat3.birthtime.getTime();
    //   const atime3 = stat3.atime.getTime();
    //   const mtime3 = stat3.mtime.getTime();
    //   const ctime3 = stat3.ctime.getTime();
    //   expect(birthtime3).toEqual(birthtime2);
    //   expect(atime3).toEqual(atime2);
    //   expect(ctime3).toBeGreaterThan(ctime2); // This is not updating!
    //   expect(mtime3).toEqual(mtime2);

    //   await sleep(50);
    //   //mtime updates when written to.
    //   await efs.write(fd, Buffer.from('hello!'));
    //   let stat4 = await efs.stat(dir);
    //   const birthtime4 = stat4.birthtime.getTime();
    //   const atime4 = stat4.atime.getTime();
    //   const mtime4 = stat4.mtime.getTime();
    //   const ctime4 = stat4.ctime.getTime();
    //   expect(birthtime4).toEqual(birthtime3);
    //   expect(atime4).toEqual(atime3);
    //   expect(ctime4).toBeGreaterThan(ctime3);
    //   expect(mtime4).toBeGreaterThan(mtime3);
    // });
    // test('Dir metadata changes while adding or removing files.', async () => {
    //   const dir = 'directory';
    //   const PUT = path.join(dir, 'file');
    //   await efs.mkdir(dir);
    //   let stat0 = await efs.stat(dir);
    //   const birthtime0 = stat0.birthtime.getTime();
    //   const atime0 = stat0.atime.getTime();
    //   const mtime0 = stat0.mtime.getTime();
    //   const ctime0 = stat0.ctime.getTime();

    //   await sleep(50);
    //   // c and mtime update when creating a file.
    //   await efs.writeFile(PUT, '');
    //   let stat1 = await efs.stat(dir);
    //   const birthtime1 = stat1.birthtime.getTime();
    //   const atime1 = stat1.atime.getTime();
    //   const mtime1 = stat1.mtime.getTime();
    //   const ctime1 = stat1.ctime.getTime();
    //   expect(birthtime1).toEqual(birthtime0);
    //   expect(atime1).toEqual(atime0);
    //   expect(ctime1).toBeGreaterThan(ctime0);
    //   expect(mtime1).toBeGreaterThan(mtime0);

    //   await sleep(50);
    //   // c and mtime update when deleting a file.
    //   await efs.unlink(PUT);
    //   let stat2 = await efs.stat(dir);
    //   const birthtime2 = stat2.birthtime.getTime();
    //   const atime2 = stat2.atime.getTime();
    //   const mtime2 = stat2.mtime.getTime();
    //   const ctime2 = stat2.ctime.getTime();
    //   expect(birthtime2).toEqual(birthtime1);
    //   expect(atime2).toEqual(atime1);
    //   expect(ctime2).toBeGreaterThan(ctime1);
    //   expect(mtime2).toBeGreaterThan(mtime1);

    //   await sleep(50);
    //   //ctime updates when permissions change.
    //   await efs.chown(dir, 10, 10);
    //   await efs.chown(dir, 0, 0);
    //   let stat3 = await efs.stat(dir);
    //   const birthtime3 = stat3.birthtime.getTime();
    //   const atime3 = stat3.atime.getTime();
    //   const mtime3 = stat3.mtime.getTime();
    //   const ctime3 = stat3.ctime.getTime();
    //   expect(birthtime3).toEqual(birthtime2);
    //   expect(atime3).toEqual(atime2);
    //   expect(ctime3).toBeGreaterThan(ctime2); // This is not updating!
    //   expect(mtime3).toEqual(mtime2);
  });
  describe('Changing fd location in a file (lseek) while writing/reading (and updating) fd pos', () => {
    let fd;
    beforeEach(async () => {
      fd = await efs.open('file', flags.O_RDWR | flags.O_CREAT);
      await efs.fallocate(fd, 0, 200);
    });

    test('Seeking while writing to file.', async () => {
      await efs.lseek(fd, 0, flags.SEEK_SET);
      // Seeking before.
      await Promise.all([
        efs.lseek(fd, 10, flags.SEEK_CUR),
        efs.write(fd, Buffer.from('A'.repeat(10))),
      ]);
      let pos = await efs.lseek(fd, 0, flags.SEEK_CUR);
      expect(pos).toEqual(20);

      await efs.lseek(fd, 0, flags.SEEK_SET);
      // Seeking after.
      await Promise.all([
        efs.write(fd, Buffer.from('A'.repeat(10))),
        efs.lseek(fd, 10, flags.SEEK_CUR),
      ]);
      pos = await efs.lseek(fd, 0, flags.SEEK_CUR);
      expect(pos).toEqual(10);
    });
    test('Seeking while reading a file.', async () => {
      await efs.write(fd, Buffer.from('AAAAAAAAAABBBBBBBBBBCCCCCCCCCC'));
      await efs.lseek(fd, 0, flags.SEEK_SET);
      // Seeking before.
      const buf = Buffer.alloc(10);
      await Promise.all([
        efs.lseek(fd, 10, flags.SEEK_CUR),
        efs.read(fd, buf, undefined, 10),
      ]);
      const pos = await efs.lseek(fd, 0, flags.SEEK_CUR);
      expect(pos).toEqual(20);
      expect(buf.toString()).toContain('B');

      await efs.lseek(fd, 0, flags.SEEK_SET);
      // Seeking after.
      const buf2 = Buffer.alloc(10);
      await Promise.all([
        efs.read(fd, buf2, undefined, 10),
        efs.lseek(fd, 10, flags.SEEK_CUR),
      ]);
      const pos2 = await efs.lseek(fd, 0, flags.SEEK_CUR);
      expect(pos2).toEqual(20);
      expect(buf2.toString()).toContain('B');
    });
    test('Seeking while updating fd pos.', async () => {
      await efs.lseek(fd, 0, flags.SEEK_SET);
      // Seeking before.
      await Promise.all([
        efs.lseek(fd, 10, flags.SEEK_CUR),
        efs.lseek(fd, 20, flags.SEEK_SET),
      ]);
      const pos = await efs.lseek(fd, 0, flags.SEEK_CUR);
      expect(pos).toEqual(20);

      await efs.lseek(fd, 0, flags.SEEK_SET);
      // Seeking after.
      await Promise.all([
        efs.lseek(fd, 20, flags.SEEK_SET),
        efs.lseek(fd, 10, flags.SEEK_CUR),
      ]);
      const pos2 = await efs.lseek(fd, 0, flags.SEEK_CUR);
      expect(pos2).toEqual(30);
    });
  });
  describe('checking if nlinks gets clobbered.', () => {
    test('when creating and removing the file.', async () => {
      // Need a way to check if only one inode was created in the end.
      // otherwise do we have dangling inodes that are not going to get collected?
      await Promise.all([
        efs.writeFile('file', ''),
        efs.writeFile('file', ''),
        efs.writeFile('file', ''),
        efs.writeFile('file', ''),
        efs.writeFile('file', ''),
      ]);
      const stat = await efs.stat('file');
      expect(stat.nlink).toEqual(1);

      const fd = await efs.open('file', 'r');
      try {
        await Promise.all([
          efs.unlink('file'),
          efs.unlink('file'),
          efs.unlink('file'),
          efs.unlink('file'),
          efs.unlink('file'),
        ]);
      } catch (err) {
        // Do nothing
      }
      const stat2 = await efs.fstat(fd);
      expect(stat2.nlink).toEqual(0);
      await efs.close(fd);
    });
    test('when creating and removing links.', async () => {
      await efs.writeFile('file', '');

      // One link to a file multiple times.
      try {
        await Promise.all([
          efs.link('file', 'link'),
          efs.link('file', 'link'),
          efs.link('file', 'link'),
          efs.link('file', 'link'),
          efs.link('file', 'link'),
        ]);
      } catch (e) {
        // Do nothing
      }
      const stat = await efs.stat('file');
      expect(stat.nlink).toEqual(2);

      // Removing one link multiple times.
      try {
        await Promise.all([
          efs.unlink('link'),
          efs.unlink('link'),
          efs.unlink('link'),
          efs.unlink('link'),
          efs.unlink('link'),
        ]);
      } catch (e) {
        // Do nothing
      }
      const stat2 = await efs.stat('file');
      expect(stat2.nlink).toEqual(1);

      // Multiple links to a file.
      await Promise.all([
        efs.link('file', 'link1'),
        efs.link('file', 'link2'),
        efs.link('file', 'link3'),
        efs.link('file', 'link4'),
        efs.link('file', 'link5'),
      ]);
      const stat3 = await efs.stat('file');
      expect(stat3.nlink).toEqual(6);

      // Removing one link multiple times.
      try {
        await Promise.all([
          efs.unlink('link1'),
          efs.unlink('link2'),
          efs.unlink('link3'),
          efs.unlink('link4'),
          efs.unlink('link5'),
        ]);
      } catch (e) {
        // Do nothing
      }
      const stat4 = await efs.stat('file');
      expect(stat4.nlink).toEqual(1);
    });
  });
  test('Read stream and write stream to same file', async (done) => {
    await efs.writeFile('file', '');
    const readStream = await efs.createReadStream('file');
    const writeStream = await efs.createWriteStream('file', { flags: 'w+' });
    const contents = 'A'.repeat(4096);

    //Write two blocks.
    writeStream.write(Buffer.from(contents));
    // WriteStream.end();
    await sleep(1000);
    let readString = '';
    for await (const data of readStream) {
      readString += data;
    }
    expect(readString.length).toEqual(4096);
    writeStream.end(async () => {
      await sleep(100);
      done();
    });

    // WriteStream.write(Buffer.from(contents));
    // await sleep(1000);
    //
    // for await (const data of readStream) {
    //   readString += data;
    // }
    // expect(readString.length).toEqual(4096);
  });
  test('One write stream and one fd writing to the same file', async () => {
    await efs.writeFile('file', '');
    const fd = await efs.open('file', flags.O_RDWR);
    const writeStream = await efs.createWriteStream('file');

    await Promise.all([
      new Promise((res) => {
        writeStream.write(Buffer.from('A'.repeat(10)), () => {
          res(null);
        });
      }),
      efs.write(fd, Buffer.from('B'.repeat(10))),
      new Promise((res) => {
        writeStream.write(Buffer.from('C'.repeat(10)), () => {
          res(null);
        });
      }),
      new Promise((res) => {
        writeStream.end();
        writeStream.on('finish', () => {
          res(null);
        });
      }),
    ]);

    // The writeStream overwrites the file. likely because it finishes last and writes everything at once.
    const fileContents = (await efs.readFile('file')).toString();
    expect(fileContents).toContain('A');
    expect(fileContents).not.toContain('B');
    expect(fileContents).toContain('C');
  });
  test('One read stream and one fd writing to the same file', async () => {
    await efs.writeFile('file', '');
    const fd = await efs.open('file', flags.O_RDWR);
    const readStream = await efs.createReadStream('file');
    let readData = '';

    readStream.on('data', (data) => {
      readData += data;
    });
    const streamEnd = new Promise((res) => {
      readStream.on('end', () => {
        res(null);
      });
    });

    await Promise.all([
      efs.write(fd, Buffer.from('A'.repeat(10))),
      efs.write(fd, Buffer.from('B'.repeat(10))),
      streamEnd,
    ]);

    await sleep(100);

    // Only the last write data gets read.
    expect(readData).not.toContain('A');
    expect(readData).toContain('B');
    expect(readData).not.toContain('C');
  });
  test('One write stream and one fd reading to the same file', async () => {
    await efs.writeFile('file', '');
    const fd = await efs.open('file', flags.O_RDWR);
    const writeStream = await efs.createWriteStream('file');
    const buf1 = Buffer.alloc(20);
    const buf2 = Buffer.alloc(20);
    const buf3 = Buffer.alloc(20);

    await Promise.all([
      new Promise((res) => {
        writeStream.write(Buffer.from('A'.repeat(10)), () => {
          res(null);
        });
      }),
      efs.read(fd, buf1, 0, 20),
      new Promise((res) => {
        writeStream.write(Buffer.from('B'.repeat(10)), () => {
          res(null);
        });
      }),
      efs.read(fd, buf2, 0, 20),
      new Promise((res) => {
        writeStream.end();
        writeStream.on('finish', () => {
          res(null);
        });
      }),
    ]);
    await efs.read(fd, buf3, 0, 20);

    // Efs.read only reads data after the write stream finishes.
    expect(buf1.toString()).not.toContain('AB');
    expect(buf2.toString()).not.toContain('AB');
    expect(buf3.toString()).toContain('AB');
  });
  test('One read stream and one fd reading to the same file', async () => {
    await efs.writeFile('file', 'AAAAAAAAAABBBBBBBBBB');
    const fd = await efs.open('file', flags.O_RDONLY);
    const readStream = await efs.createReadStream('file');
    let readData = '';

    readStream.on('data', (data) => {
      readData += data;
    });
    const streamEnd = new Promise((res) => {
      readStream.on('end', () => {
        res(null);
      });
    });
    const buf = Buffer.alloc(20);

    await Promise.all([efs.read(fd, buf, 0, 20), streamEnd]);

    await sleep(100);

    // Ok, is efs.read() broken?
    expect(readData).toContain('AB');
    expect(buf.toString()).toContain('AB');
  });
  test('Two write streams to the same file', async () => {
    const contentSize = 4096 * 3;
    const contents = [
      'A'.repeat(contentSize),
      'B'.repeat(contentSize),
      'C'.repeat(contentSize),
    ];
    let streams: Array<WriteStream> = [];

    // Each stream sequentially.
    for (let i = 0; i < contents.length; i++) {
      streams.push(await efs.createWriteStream('file'));
    }
    for (let i = 0; i < streams.length; i++) {
      streams[i].write(Buffer.from(contents[i]));
    }
    for (const stream of streams) {
      stream.end();
    }

    await sleep(1000);
    const fileContents = (await efs.readFile('file')).toString();
    expect(fileContents).not.toContain('A');
    expect(fileContents).not.toContain('B');
    expect(fileContents).toContain('C');

    await efs.unlink('file');

    // Each stream interlaced.
    const contents2 = ['A'.repeat(4096), 'B'.repeat(4096), 'C'.repeat(4096)];
    streams = [];
    for (let i = 0; i < contents2.length; i++) {
      streams.push(await efs.createWriteStream('file'));
    }
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < streams.length; i++) {
        // Order we write to changes.
        streams[(j + i) % 3].write(Buffer.from(contents2[(j + i) % 3]));
      }
    }
    for (const stream of streams) {
      stream.end();
    }
    await sleep(1000);
    const fileContents2 = (await efs.readFile('file')).toString();
    expect(fileContents2).not.toContain('A');
    expect(fileContents2).not.toContain('B');
    expect(fileContents2).toContain('C');
    // Conclusion. the last stream to close writes the whole contents of it's buffer to the file.
  });
  test('Writing a file and deleting the file at the same time using writeFile', async () => {
    await efs.writeFile('file', '');

    // Odd error, needs fixing.
    await Promise.all([efs.writeFile('file', 'CONTENT!'), efs.unlink('file')]);
    await expectError(efs.readFile('file'), errno.ENOENT);
  });
  test('opening a file and deleting the file at the same time', async () => {
    await efs.writeFile('file', '');

    // Odd error, needs fixing.
    const results = await Promise.all([
      efs.open('file', flags.O_WRONLY),
      efs.unlink('file'),
    ]);
    const fd = results[0];
    await efs.write(fd, 'yooo');
  });
  test('Writing a file and deleting the file at the same time for fd', async () => {
    await efs.writeFile('file', '');

    const fd1 = await efs.open('file', flags.O_WRONLY);
    await Promise.all([
      efs.write(fd1, Buffer.from('TESTING WOOo')),
      efs.unlink('file'),
    ]);
    await efs.close(fd1);
    expect(await efs.readdir('.')).toEqual([]);

    await efs.writeFile('file', '');
    const fd2 = await efs.open('file', flags.O_WRONLY);
    await Promise.all([
      efs.unlink('file'),
      efs.write(fd2, Buffer.from('TESTING TWOOo')),
    ]);
    await efs.close(fd2);
    expect(await efs.readdir('.')).toEqual([]);
  });
  test('Writing a file and deleting the file at the same time for stream', async () => {
    await efs.writeFile('file', '');

    const writeStream1 = await efs.createWriteStream('file');
    await Promise.all([
      new Promise((res) => {
        writeStream1.write(Buffer.from('AAAAAAAAAA'), () => {
          writeStream1.end(() => {
            res(null);
          });
        });
      }),
      efs.unlink('file'),
    ]);
    expect(await efs.readdir('.')).toEqual([]);

    await efs.writeFile('file', '');
    const writeStream2 = await efs.createWriteStream('file');
    await Promise.all([
      efs.unlink('file'),
      new Promise((res) => {
        writeStream2.write(Buffer.from('BBBBBBBBBB'), () => {
          writeStream2.end(() => {
            res(null);
          });
        });
      }),
    ]);
    expect(await efs.readdir('.')).toEqual([]);
  });
  test('Appending to a file that is being written to for fd ', async () => {
    await efs.writeFile('file', '');
    const fd1 = await efs.open('file', flags.O_WRONLY);

    await Promise.all([
      efs.write(fd1, Buffer.from('AAAAAAAAAA')),
      efs.appendFile('file', 'BBBBBBBBBB'),
    ]);

    const fileContents = (await efs.readFile('file')).toString();
    expect(fileContents).toContain('A');
    expect(fileContents).toContain('B');
    expect(fileContents).toContain('AB');
    await efs.close(fd1);

    await efs.writeFile('file', '');
    const fd2 = await efs.open('file', flags.O_WRONLY);
    await Promise.all([
      efs.appendFile('file', 'BBBBBBBBBB'),
      efs.write(fd2, Buffer.from('AAAAAAAAAA')),
    ]);

    // The append seems to happen after the write.
    const fileContents2 = (await efs.readFile('file')).toString();
    expect(fileContents2).toContain('A');
    expect(fileContents2).toContain('B');
    expect(fileContents2).toContain('AB');
    await sleep(1000);
    await efs.close(fd2);
  });
  test('Appending to a file that is being written for stream', async () => {
    await efs.writeFile('file', '');
    const writeStream = await efs.createWriteStream('file');
    await Promise.all([
      new Promise((res) => {
        writeStream.write(Buffer.from('AAAAAAAAAA'), () => {
          writeStream.end(() => {
            res(null);
          });
        });
      }),
      efs.appendFile('file', 'BBBBBBBBBB'),
    ]);

    const fileContents = (await efs.readFile('file')).toString();
    expect(fileContents).toContain('A');
    expect(fileContents).toContain('B');
    expect(fileContents).toContain('AB');

    await efs.writeFile('file', '');
    const writeStream2 = await efs.createWriteStream('file');
    await Promise.all([
      efs.appendFile('file', 'BBBBBBBBBB'),
      new Promise((res) => {
        writeStream2.write(Buffer.from('AAAAAAAAAA'), () => {
          writeStream2.end(() => {
            res(null);
          });
        });
      }),
    ]);

    // Append seems to happen after stream.
    const fileContents2 = (await efs.readFile('file')).toString();
    expect(fileContents2).toContain('A');
    expect(fileContents2).toContain('B');
  });
  test('Copying a file that is being written to for fd', async () => {
    await efs.writeFile('file', 'AAAAAAAAAA');
    const fd1 = await efs.open('file', flags.O_WRONLY);

    await Promise.all([
      efs.write(fd1, Buffer.from('BBBBBBBBBB')),
      efs.copyFile('file', 'fileCopy'),
    ]);

    // Gets overwritten before copy.
    const fileContents = (await efs.readFile('fileCopy')).toString();
    expect(fileContents).not.toContain('A');
    expect(fileContents).toContain('B');

    await efs.close(fd1);
    await efs.writeFile('file', 'AAAAAAAAAA');
    const fd2 = await efs.open('file', flags.O_WRONLY);
    await efs.unlink('fileCopy');

    await Promise.all([
      efs.copyFile('file', 'fileCopy'),
      efs.write(fd2, Buffer.from('BBBBBBBBBB')),
    ]);

    // Also gets overwritten before copy.
    const fileContents2 = (await efs.readFile('fileCopy')).toString();
    expect(fileContents2).not.toContain('A');
    expect(fileContents2).toContain('B');
  });
  test('Copying a file that is being written to for stream', async () => {
    await efs.writeFile('file', 'AAAAAAAAAA');
    const writeStream = await efs.createWriteStream('file');

    await Promise.all([
      new Promise((res) => {
        writeStream.write(Buffer.from('BBBBBBBBBB'), () => {
          writeStream.end(() => {
            res(null);
          });
        });
      }),
      efs.copyFile('file', 'fileCopy'),
    ]);

    // Write happens first.
    const fileContents = (await efs.readFile('fileCopy')).toString();
    expect(fileContents).not.toContain('A');
    expect(fileContents).toContain('B');

    await efs.writeFile('file', 'AAAAAAAAAA');
    await efs.unlink('fileCopy');
    const writeStream2 = await efs.createWriteStream('file');

    await Promise.all([
      efs.copyFile('file', 'fileCopy'),
      new Promise((res) => {
        writeStream2.write(Buffer.from('BBBBBBBBBB'), () => {
          writeStream2.end(() => {
            res(null);
          });
        });
      }),
    ]);

    // Copy happens after stream.
    const fileContents2 = (await efs.readFile('fileCopy')).toString();
    expect(fileContents2).not.toContain('A');
    expect(fileContents2).toContain('B');
    await sleep(100);
  });
  test('removing a dir while renaming it.', async () => {
    // Create the directory
    await efs.mkdir('dir');
    // Removing and renaming.
    await Promise.all([
      efs.rmdir('dir'),
      expectError(efs.rename('dir', 'renamedDir'), errno.ENOENT),
    ]);
    let list = await efs.readdir('.');
    expect(list).toEqual([]);

    // Reverse order.
    await efs.mkdir('dir2');
    await Promise.all([
      expectError(efs.rename('dir2', 'renamedDir2'), errno.ENOENT),
      efs.rmdir('dir2'),
    ]);
    list = await efs.readdir('.');
    expect(list).toEqual([]);
  });
});
