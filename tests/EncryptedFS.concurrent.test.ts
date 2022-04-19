import type { FdIndex } from '@/fd/types';
import type { WriteStream } from '@/streams';
import type { INodeIndex, INodeData } from '@/inodes/types';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { code as errno } from 'errno';
import { DB } from '@matrixai/db';
import { withG } from '@matrixai/resources';
import EncryptedFS from '@/EncryptedFS';
import { ErrorEncryptedFSError } from '@/errors';
import * as utils from '@/utils';
import * as constants from '@/constants';
import INodeManager from '@/inodes/INodeManager';
import { expectError, sleep } from './utils';

describe(`${EncryptedFS.name} Concurrency`, () => {
  const logger = new Logger(`${EncryptedFS.name} Concurrency`, LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const dbKey: Buffer = utils.generateKeySync(256);
  let dataDir: string;
  let db: DB;
  let iNodeMgr: INodeManager;
  let efs: EncryptedFS;
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    db = await DB.createDB({
      dbPath: dataDir,
      crypto: {
        key: dbKey!,
        ops: {
          encrypt: utils.encrypt,
          decrypt: utils.decrypt,
        },
      },
      logger: logger.getChild(DB.name),
    });
    iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger: logger.getChild(INodeManager.name),
    });
    efs = await EncryptedFS.createEncryptedFS({
      db,
      iNodeMgr,
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
  describe('concurrent inode creation', () => {
    test('EncryptedFS.open', async () => {
      // Only one call wins the race to create the file
      await Promise.all([
        efs.open('test', constants.O_RDWR | constants.O_CREAT),
        efs.open('test', constants.O_RDWR | constants.O_CREAT),
        efs.open('test', constants.O_RDWR | constants.O_CREAT),
        efs.open('test', constants.O_RDWR | constants.O_CREAT),
      ]);
      expect(await efs.readFile('test', { encoding: 'utf-8' })).toBe('');
      const inodeDatas: Array<INodeData> = [];
      for await (const inodeData of iNodeMgr.getAll()) {
        inodeDatas.push(inodeData);
      }
      expect(inodeDatas).toStrictEqual([
        { ino: 1, type: 'Directory', gc: false },
        { ino: 2, type: 'File', gc: false },
      ]);
    });

    // test inode creation as well

  });
  describe('concurrent file writes', () => {
    test('EncryptedFS.write on multiple file descriptors', async () => {
      // Concurrent writes of the same length results in "last write wins"
      let fds: Array<FdIndex> = [
        await efs.open('test', constants.O_RDWR | constants.O_CREAT),
        await efs.open('test', constants.O_RDWR | constants.O_CREAT),
      ];
      let contents = ['one', 'two'];
      let promises: Array<Promise<any>>;
      promises = [];
      for (let i = 0; i < 2; i++) {
        promises.push(efs.write(fds[i], contents[i]));
      }
      await Promise.all(promises);
      expect(['one', 'two']).toContainEqual(
        await efs.readFile('test', { encoding: 'utf-8' }),
      );
      for (const fd of fds) {
        await efs.close(fd);
      }
      // Concurrent writes of different length results in "last write wins" or a merge
      fds = [
        await efs.open('test', constants.O_RDWR | constants.O_CREAT),
        await efs.open('test', constants.O_RDWR | constants.O_CREAT),
      ];
      contents = ['one1', 'two'];
      promises = [];
      for (let i = 0; i < 2; i++) {
        promises.push(efs.write(fds[i], contents[i]));
      }
      expect(['one1', 'two', 'two1']).toContainEqual(
        await efs.readFile('test', { encoding: 'utf-8' }),
      );
      for (const fd of fds) {
        await efs.close(fd);
      }
    });
    test('EncryptedFS.write on the same file descriptor', async () => {
      await efs.writeFile('test', '');
      const fd = await efs.open('test', 'w');
      await Promise.all([
        efs.write(fd, Buffer.from('aaa')),
        efs.write(fd, Buffer.from('bbb')),
      ]);
      expect(['aaabbb', 'bbbaaa']).toContainEqual(
        await efs.readFile('test', { encoding: 'utf-8' }),
      );
      await efs.close(fd);
    });
    test('EncryptedFS.writeFile', async () => {
      let promises: Array<Promise<void>>;
      // Concurrent writes of the same length results in "last write wins"
      promises = [];
      for (const data of ['one', 'two']) {
        promises.push(efs.writeFile('test', data));
      }
      await Promise.all(promises);
      expect(['one', 'two']).toContainEqual(
        await efs.readFile('test', { encoding: 'utf-8' }),
      );
      // Concurrent writes of different length results in "last write wins" or a merge
      for (let i = 0; i < 10; i++) {
        promises = [];
        for (const data of ['one1', 'two']) {
          promises.push(efs.writeFile('test', data));
        }
        await Promise.all(promises);
        expect(['one1', 'two', 'two1']).toContainEqual(
          await efs.readFile('test', { encoding: 'utf-8' }),
        );
      }
      // Explicit last write wins
      promises = [
        (async () => {
          // One is written last
          await sleep(0);
          return efs.writeFile('test', 'one');
        })(),
        efs.writeFile('test', 'two'),
      ];
      await Promise.all(promises);
      expect(['one']).toContainEqual(
        await efs.readFile('test', { encoding: 'utf-8' }),
      );
      promises = [
        efs.writeFile('test', 'one'),
        (async () => {
          // Two1 is written last
          await sleep(0);
          return efs.writeFile('test', 'two1');
        })(),
      ];
      await Promise.all(promises);
      expect(['two1']).toContainEqual(
        await efs.readFile('test', { encoding: 'utf-8' }),
      );
      const inodeDatas: Array<INodeData> = [];
      for await (const inodeData of iNodeMgr.getAll()) {
        inodeDatas.push(inodeData);
      }
      expect(inodeDatas).toStrictEqual([
        { ino: 1, type: 'Directory', gc: false },
        { ino: 2, type: 'File', gc: false },
      ]);
    });
    test('EncryptedFS.appendFile', async () => {
      await efs.writeFile('test', 'original');
      let promises: Array<Promise<void>>;
      // Concurrent appends results in mutually exclusive writes
      promises = [efs.appendFile('test', 'one'), efs.appendFile('test', 'two')];
      await Promise.all(promises);
      // Either order of appending is acceptable
      expect(['originalonetwo', 'originaltwoone']).toContainEqual(
        await efs.readFile('test', { encoding: 'utf-8' }),
      );
    });
  });
  describe('concurrent directory manipulation', () => {
    test('EncryptedFS.mkdir', async () => {
      const results = await Promise.allSettled([
        efs.mkdir('dir'),
        efs.mkdir('dir'),
      ]);
      expect(results.some((result) => {
        return result.status === 'fulfilled';
      })).toBe(true);
      expect(results.some((result) => {
        const status = result.status === 'rejected';
        if (status) {
          expect(result.reason).toBeInstanceOf(ErrorEncryptedFSError);
          expect(result.reason).toHaveProperty('code', errno.EEXIST.code);
          expect(result.reason).toHaveProperty('errno', errno.EEXIST.errno);
          expect(result.reason).toHaveProperty('description', errno.EEXIST.description);
        }
        return status;
      })).toBe(true);
    });
    test('EncryptedFS.mkdir with recursive creation', async () => {
      await Promise.all([
        efs.mkdir('1/dira/dirb', { recursive: true }),
        efs.mkdir('1/dira/dirb', { recursive: true }),
      ]);
      expect(await efs.readdir('1/dira')).toStrictEqual(['dirb']);
      expect(await efs.readdir('1/dira/dirb')).toStrictEqual([]);
      // Asymmetric directory creation
      // the first promise will create dira and dira/dirb
      // the second promise will create dira/dirb/dirc
      await Promise.all([
        efs.mkdir('2/dira/dirb', { recursive: true }),
        efs.mkdir('2/dira/dirb/dirc', { recursive: true }),
      ]);
      expect(await efs.readdir('2/dira/dirb')).toStrictEqual(['dirc']);
      expect(await efs.readdir('2/dira/dirb/dirc')).toStrictEqual([]);
    });
    test('EncryptedFS.rename', async () => {
      // Only the first rename works, the rest fail
      await efs.mkdir('test');
      const results = await Promise.allSettled([
        efs.rename('test', 'one'),
        efs.rename('test', 'two'),
        efs.rename('test', 'three'),
        efs.rename('test', 'four'),
        efs.rename('test', 'five'),
        efs.rename('test', 'six'),
      ]);
      const i = results.findIndex((result) => result.status === 'fulfilled');
      results.splice(i, 1);
      expect(results.every((result: PromiseRejectedResult) => {
        const status = result.status === 'rejected';
        if (status) {
          expect(result.reason).toBeInstanceOf(ErrorEncryptedFSError);
          expect(result.reason).toHaveProperty('code', errno.ENOENT.code);
          expect(result.reason).toHaveProperty('errno', errno.ENOENT.errno);
          expect(result.reason).toHaveProperty('description', errno.ENOENT.description);
        }
        return status;
      })).toBe(true);
      expect(await efs.readdir('.')).toContain('one');
    });
    test.only('EncryptedFS.readdir and EncryptedFS.rmdir', async () => {
      await efs.mkdir('dir');
      // It is possible for only one to succeed or both can succeed
      let results = await Promise.allSettled([
        (async () => {
          // await sleep(10);
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.rmdir('dir');
        })()
      ]);
      if (results.every((result) => result.status === 'fulfilled')) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: []},
          { status: 'fulfilled', value: undefined},
        ]);
      } else {
        // Has to be readdir that fails if rmdir quickly
        const result = results[0] as PromiseRejectedResult;
        expect(result.status).toBe('rejected');
        expect(result.reason).toBeInstanceOf(ErrorEncryptedFSError);
        expect(result.reason).toHaveProperty('code', errno.ENOENT.code);
        expect(result.reason).toHaveProperty('errno', errno.ENOENT.errno);
        expect(result.reason).toHaveProperty('description', errno.ENOENT.description);
      }
      results = await Promise.allSettled([
        (async () => {
          await sleep(0);
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.rmdir('dir');
        })()
      ]);
      if (results.every((result) => result.status === 'fulfilled')) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: []},
          { status: 'fulfilled', value: undefined},
        ]);
      } else {
        // Has to be readdir that fails if rmdir quickly
        const result = results[0] as PromiseRejectedResult;
        expect(result.status).toBe('rejected');
        expect(result.reason).toBeInstanceOf(ErrorEncryptedFSError);
        expect(result.reason).toHaveProperty('code', errno.ENOENT.code);
        expect(result.reason).toHaveProperty('errno', errno.ENOENT.errno);
        expect(result.reason).toHaveProperty('description', errno.ENOENT.description);
      }
    });

  //   test('reading a directory while adding/removing entries in the directory', async () => {
  //     await efs.mkdir('dir');
  //     const file1 = path.join('dir', 'file1');
  //     const results1 = await Promise.all([
  //       efs.writeFile(file1, 'test1'),
  //       efs.readdir('dir'),
  //     ]);
  //     // Results may or may not contain file1
  //     expect([[], ['file1']]).toContainEqual(results1[1]);
  //     expect(await efs.readdir('dir')).toContain('file1');
  //     const results2 = await Promise.all([
  //       efs.unlink(file1),
  //       efs.readdir('dir'),
  //     ]);
  //     // Results may or may not contain file1
  //     expect([[], ['file1']]).toContainEqual(results2[1]);
  //     expect(await efs.readdir('dir')).not.toContain('file1');
  //   });
  //   test('reading a directory while renaming entries', async () => {
  //     await efs.mkdir('dir');
  //     await efs.writeFile(path.join('dir', 'file1'));
  //     const results1 = await Promise.all([
  //       efs.readdir('dir'),
  //       efs.rename(path.join('dir', 'file1'), path.join('dir', 'file2')),
  //     ]);
  //     expect([['file1'], ['file2']]).toContainEqual(results1[0]);
  //     expect(await efs.readdir('dir')).toContain('file2');
  //     const results2 = await Promise.all([
  //       efs.rename(path.join('dir', 'file2'), path.join('dir', 'file1')),
  //       efs.readdir('dir'),
  //     ]);
  //     expect([['file1'], ['file2']]).toContainEqual(results2[1]);
  //     expect(await efs.readdir('dir')).toContain('file1');
  //   });
  //   test('removing a dir while renaming it', async () => {
  //     // Create the directory
  //     await efs.mkdir('dir');
  //     // Removing and renaming.
  //     await Promise.all([
  //       efs.rmdir('dir'),
  //       expectError(
  //         efs.rename('dir', 'renamedDir'),
  //         ErrorEncryptedFSError,
  //         errno.ENOENT,
  //       ),
  //     ]);
  //     let list = await efs.readdir('.');
  //     expect(list).toEqual([]);
  //     // Reverse order
  //     await efs.mkdir('dir2');
  //     await Promise.all([
  //       expectError(
  //         efs.rename('dir2', 'renamedDir2'),
  //         ErrorEncryptedFSError,
  //         errno.ENOENT,
  //       ),
  //       efs.rmdir('dir2'),
  //     ]);
  //     list = await efs.readdir('.');
  //     expect(list).toEqual([]);
  //   });



  });
  describe('concurrent symlinking', () => {

  });
  describe('concurrent inode linking and unlinking', () => {

  });

  // describe('allocating/truncating a file while writing (stream or fd)', () => {
  //   test('allocating while writing to fd', async () => {
  //     const fd = await efs.open('file', constants.O_WRONLY | constants.O_CREAT);

  //     const content = 'A'.repeat(4096 * 2);

  //     await Promise.all([
  //       efs.write(fd, Buffer.from(content)),
  //       efs.fallocate(fd, 0, 4096 * 3),
  //     ]);

  //     // Both operations complete, order makes no diference.
  //     const fileContents = await efs.readFile('file');
  //     expect(fileContents.length).toBeGreaterThan(4096 * 2);
  //     expect(fileContents.toString()).toContain('A');
  //     expect(fileContents).toContain(0x00);
  //   });
  //   test('truncating while writing to fd', async () => {
  //     const fd1 = await efs.open(
  //       'file',
  //       constants.O_WRONLY | constants.O_CREAT,
  //     );

  //     const content = 'A'.repeat(4096 * 2);

  //     await Promise.all([
  //       efs.write(fd1, Buffer.from(content)),
  //       efs.ftruncate(fd1, 4096),
  //     ]);

  //     // Both operations complete, order makes no difference. Truncate doesn't do anything?
  //     const fileContents1 = await efs.readFile('file');
  //     expect(fileContents1.length).toBe(4096 * 2);
  //     expect(fileContents1.toString()).toContain('A');
  //     expect(fileContents1).not.toContain(0x00);

  //     await efs.unlink('file');

  //     const fd2 = await efs.open(
  //       'file',
  //       constants.O_WRONLY | constants.O_CREAT,
  //     );

  //     await Promise.all([
  //       efs.ftruncate(fd2, 4096),
  //       efs.write(fd2, Buffer.from(content)),
  //     ]);

  //     // Both operations complete, order makes no difference. Truncate doesn't do anything?
  //     const fileContents2 = await efs.readFile('file');
  //     expect(fileContents2.length).toBe(4096 * 2);
  //     expect(fileContents2.toString()).toContain('A');
  //     expect(fileContents2).not.toContain(0x00);
  //   });
  //   test('allocating while writing to stream', async () => {
  //     await efs.writeFile('file', '');
  //     const writeStream = efs.createWriteStream('file');
  //     const content = 'A'.repeat(4096);
  //     const fd = await efs.open('file', 'w');

  //     await Promise.all([
  //       new Promise((res) => {
  //         writeStream.write(content, () => {
  //           res(null);
  //         });
  //       }),
  //       efs.fallocate(fd, 0, 4096 * 2),
  //     ]);
  //     await new Promise((res) => {
  //       writeStream.end(() => {
  //         res(null);
  //       });
  //     });

  //     // Both operations complete, order makes no difference.
  //     const fileContents = await efs.readFile('file');
  //     expect(fileContents.length).toEqual(4096 * 2);
  //     expect(fileContents.toString()).toContain('A');
  //     expect(fileContents).toContain(0x00);
  //   });
  //   test('truncating while writing to stream', async () => {
  //     await efs.writeFile('file', '');
  //     const writeStream = efs.createWriteStream('file');
  //     const content = 'A'.repeat(4096 * 2);
  //     const promise1 = new Promise((res) => {
  //       writeStream.write(content, () => {
  //         res(null);
  //       });
  //     });

  //     await Promise.all([promise1, efs.truncate('file', 4096)]);
  //     await new Promise((res) => {
  //       writeStream.end(() => {
  //         res(null);
  //       });
  //     });

  //     // Both operations complete, order makes no difference. Truncate doesn't do anything?
  //     const fileContents = await efs.readFile('file');
  //     expect(fileContents.length).toEqual(4096 * 2);
  //     expect(fileContents.toString()).toContain('A');
  //     expect(fileContents).not.toContain(0x00);
  //   });
  // });
  // test('file metadata changes while reading/writing a file', async () => {
  //   const fd1 = await efs.promises.open(
  //     'file',
  //     constants.O_WRONLY | constants.O_CREAT,
  //   );
  //   const content = 'A'.repeat(2);
  //   await Promise.all([
  //     efs.promises.writeFile(fd1, Buffer.from(content)),
  //     efs.promises.utimes('file', 0, 0),
  //   ]);
  //   let stat = await efs.promises.stat('file');
  //   expect(stat.atime.getMilliseconds()).toBe(0);
  //   expect(stat.mtime.getMilliseconds()).toBe(0);
  //   await efs.close(fd1);
  //   await efs.unlink('file');

  //   const fd2 = await efs.promises.open(
  //     'file',
  //     constants.O_WRONLY | constants.O_CREAT,
  //   );
  //   await Promise.all([
  //     efs.promises.utimes('file', 0, 0),
  //     efs.promises.writeFile(fd2, Buffer.from(content)),
  //   ]);
  //   stat = await efs.promises.stat('file');
  //   expect(stat.atime.getMilliseconds()).toBe(0);
  //   expect(stat.mtime.getMilliseconds()).toBeGreaterThan(0);
  //   await efs.close(fd2);
  // });
  // test('dir metadata changes while reading/writing a file', async () => {
  //   const dir = 'directory';
  //   const PUT = path.join(dir, 'file');
  //   await efs.mkdir(dir);
  //   const content = 'A'.repeat(2);
  //   await Promise.all([
  //     efs.promises.writeFile(PUT, Buffer.from(content)),
  //     efs.promises.utimes(dir, 0, 0),
  //   ]);
  //   let stat = await efs.promises.stat(dir);
  //   expect(stat.atime.getMilliseconds()).toBe(0);
  //   await efs.unlink(PUT);
  //   await efs.rmdir(dir);
  //   await efs.mkdir(dir);
  //   await Promise.all([
  //     efs.promises.utimes(dir, 0, 0),
  //     efs.promises.writeFile(PUT, Buffer.from(content)),
  //   ]);
  //   stat = await efs.promises.stat(dir);
  //   expect(stat.atime.getMilliseconds()).toBe(0);
  // });
  // describe('changing fd location in a file (lseek) while writing/reading (and updating) fd pos', () => {
  //   let fd;
  //   beforeEach(async () => {
  //     fd = await efs.open('file', constants.O_RDWR | constants.O_CREAT);
  //     await efs.fallocate(fd, 0, 200);
  //   });

  //   test('seeking while writing to file', async () => {
  //     await efs.lseek(fd, 0, constants.SEEK_SET);
  //     // Seeking before.
  //     await Promise.all([
  //       efs.lseek(fd, 10, constants.SEEK_CUR),
  //       efs.write(fd, Buffer.from('A'.repeat(10))),
  //     ]);
  //     let pos = await efs.lseek(fd, 0, constants.SEEK_CUR);
  //     expect(pos).toEqual(20);

  //     await efs.lseek(fd, 0, constants.SEEK_SET);
  //     // Seeking after.
  //     await Promise.all([
  //       efs.write(fd, Buffer.from('A'.repeat(10))),
  //       efs.lseek(fd, 10, constants.SEEK_CUR),
  //     ]);
  //     pos = await efs.lseek(fd, 0, constants.SEEK_CUR);
  //     expect(pos).toEqual(10);
  //   });
  //   test('seeking while reading a file', async () => {
  //     await efs.write(fd, Buffer.from('AAAAAAAAAABBBBBBBBBBCCCCCCCCCC'));
  //     await efs.lseek(fd, 0, constants.SEEK_SET);
  //     // Seeking before.
  //     const buf = Buffer.alloc(10);
  //     await Promise.all([
  //       efs.lseek(fd, 10, constants.SEEK_CUR),
  //       efs.read(fd, buf, undefined, 10),
  //     ]);
  //     const pos = await efs.lseek(fd, 0, constants.SEEK_CUR);
  //     expect(pos).toEqual(20);
  //     expect(buf.toString()).toContain('B');

  //     await efs.lseek(fd, 0, constants.SEEK_SET);
  //     // Seeking after.
  //     const buf2 = Buffer.alloc(10);
  //     await Promise.all([
  //       efs.read(fd, buf2, undefined, 10),
  //       efs.lseek(fd, 10, constants.SEEK_CUR),
  //     ]);
  //     const pos2 = await efs.lseek(fd, 0, constants.SEEK_CUR);
  //     expect(pos2).toEqual(20);
  //     expect(buf2.toString()).toContain('B');
  //   });
  //   test('seeking while updating fd pos.', async () => {
  //     await efs.lseek(fd, 0, constants.SEEK_SET);
  //     // Seeking before.
  //     await Promise.all([
  //       efs.lseek(fd, 10, constants.SEEK_CUR),
  //       efs.lseek(fd, 20, constants.SEEK_SET),
  //     ]);
  //     const pos = await efs.lseek(fd, 0, constants.SEEK_CUR);
  //     expect(pos).toEqual(20);

  //     await efs.lseek(fd, 0, constants.SEEK_SET);
  //     // Seeking after.
  //     await Promise.all([
  //       efs.lseek(fd, 20, constants.SEEK_SET),
  //       efs.lseek(fd, 10, constants.SEEK_CUR),
  //     ]);
  //     const pos2 = await efs.lseek(fd, 0, constants.SEEK_CUR);
  //     expect(pos2).toEqual(30);
  //   });
  // });
  // describe('checking if nlinks gets clobbered', () => {
  //   test('when creating and removing the file', async () => {
  //     // Need a way to check if only one inode was created in the end.
  //     // otherwise do we have dangling inodes that are not going to get collected?
  //     await Promise.all([
  //       efs.writeFile('file', ''),
  //       efs.writeFile('file', ''),
  //       efs.writeFile('file', ''),
  //       efs.writeFile('file', ''),
  //       efs.writeFile('file', ''),
  //     ]);
  //     const stat = await efs.stat('file');
  //     expect(stat.nlink).toEqual(1);

  //     const fd = await efs.open('file', 'r');
  //     try {
  //       await Promise.all([
  //         efs.unlink('file'),
  //         efs.unlink('file'),
  //         efs.unlink('file'),
  //         efs.unlink('file'),
  //         efs.unlink('file'),
  //       ]);
  //     } catch (err) {
  //       // Do nothing
  //     }
  //     const stat2 = await efs.fstat(fd);
  //     expect(stat2.nlink).toEqual(0);
  //     await efs.close(fd);
  //   });
  //   test('when creating and removing links.', async () => {
  //     await efs.writeFile('file', '');

  //     // One link to a file multiple times.
  //     try {
  //       await Promise.all([
  //         efs.link('file', 'link'),
  //         efs.link('file', 'link'),
  //         efs.link('file', 'link'),
  //         efs.link('file', 'link'),
  //         efs.link('file', 'link'),
  //       ]);
  //     } catch (e) {
  //       // Do nothing
  //     }
  //     const stat = await efs.stat('file');
  //     expect(stat.nlink).toEqual(2);

  //     // Removing one link multiple times.
  //     try {
  //       await Promise.all([
  //         efs.unlink('link'),
  //         efs.unlink('link'),
  //         efs.unlink('link'),
  //         efs.unlink('link'),
  //         efs.unlink('link'),
  //       ]);
  //     } catch (e) {
  //       // Do nothing
  //     }
  //     const stat2 = await efs.stat('file');
  //     expect(stat2.nlink).toEqual(1);

  //     // Multiple links to a file
  //     await Promise.all([
  //       efs.link('file', 'link1'),
  //       efs.link('file', 'link2'),
  //       efs.link('file', 'link3'),
  //       efs.link('file', 'link4'),
  //       efs.link('file', 'link5'),
  //     ]);
  //     const stat3 = await efs.stat('file');
  //     expect(stat3.nlink).toEqual(6);

  //     // Removing one link multiple times.
  //     try {
  //       await Promise.all([
  //         efs.unlink('link1'),
  //         efs.unlink('link2'),
  //         efs.unlink('link3'),
  //         efs.unlink('link4'),
  //         efs.unlink('link5'),
  //       ]);
  //     } catch (e) {
  //       // Do nothing
  //     }
  //     const stat4 = await efs.stat('file');
  //     expect(stat4.nlink).toEqual(1);
  //   });
  // });
  // test('read stream and write stream to same file', async (done) => {
  //   await efs.writeFile('file', '');
  //   const readStream = efs.createReadStream('file');
  //   const writeStream = efs.createWriteStream('file', { flags: 'w+' });
  //   const contents = 'A'.repeat(4096);

  //   // Write two blocks.
  //   writeStream.write(Buffer.from(contents));
  //   // WriteStream.end();
  //   await sleep(1000);
  //   let readString = '';
  //   for await (const data of readStream) {
  //     readString += data;
  //   }
  //   expect(readString.length).toEqual(4096);
  //   writeStream.end(async () => {
  //     await sleep(100);
  //     done();
  //   });

  //   // WriteStream.write(Buffer.from(contents));
  //   // await sleep(1000);
  //   //
  //   // for await (const data of readStream) {
  //   //   readString += data;
  //   // }
  //   // expect(readString.length).toEqual(4096);
  // });
  // test('one write stream and one fd writing to the same file', async () => {
  //   await efs.writeFile('file', '');
  //   const fd = await efs.open('file', constants.O_RDWR);
  //   const writeStream = efs.createWriteStream('file');
  //   await Promise.all([
  //     new Promise((res) => {
  //       writeStream.write(Buffer.from('A'.repeat(10)), () => {
  //         res(null);
  //       });
  //     }),
  //     efs.write(fd, Buffer.from('B'.repeat(10))),
  //     new Promise((res) => {
  //       writeStream.write(Buffer.from('C'.repeat(10)), () => {
  //         res(null);
  //       });
  //     }),
  //     new Promise((res) => {
  //       writeStream.end();
  //       writeStream.on('finish', () => {
  //         res(null);
  //       });
  //     }),
  //   ]);
  //   // The writeStream overwrites the file, likely because it finishes last and writes everything at once
  //   const fileContents = (await efs.readFile('file')).toString();
  //   expect(fileContents).toContain('A');
  //   expect(fileContents).not.toContain('B');
  //   expect(fileContents).toContain('C');
  // });
  // test('one read stream and one fd writing to the same file', async () => {
  //   await efs.writeFile('file', '');
  //   const fd = await efs.open('file', constants.O_RDWR);
  //   const readStream = efs.createReadStream('file');
  //   let readData = '';
  //   readStream.on('data', (data) => {
  //     readData += data;
  //   });
  //   const streamEnd = new Promise((res) => {
  //     readStream.on('end', () => {
  //       res(null);
  //     });
  //   });
  //   await Promise.all([
  //     efs.write(fd, Buffer.from('A'.repeat(10))),
  //     efs.write(fd, Buffer.from('B'.repeat(10))),
  //     streamEnd,
  //   ]);
  //   await sleep(100);
  //   // Only the last write data gets read
  //   expect(readData).not.toContain('A');
  //   expect(readData).toContain('B');
  //   expect(readData).not.toContain('C');
  // });
  // test('one write stream and one fd reading to the same file', async () => {
  //   await efs.writeFile('file', '');
  //   const fd = await efs.open('file', constants.O_RDWR);
  //   const writeStream = efs.createWriteStream('file');
  //   const buf1 = Buffer.alloc(20);
  //   const buf2 = Buffer.alloc(20);
  //   const buf3 = Buffer.alloc(20);
  //   await Promise.all([
  //     new Promise((res) => {
  //       writeStream.write(Buffer.from('A'.repeat(10)), () => {
  //         res(null);
  //       });
  //     }),
  //     efs.read(fd, buf1, 0, 20),
  //     new Promise((res) => {
  //       writeStream.write(Buffer.from('B'.repeat(10)), () => {
  //         res(null);
  //       });
  //     }),
  //     efs.read(fd, buf2, 0, 20),
  //     new Promise((res) => {
  //       writeStream.end();
  //       writeStream.on('finish', () => {
  //         res(null);
  //       });
  //     }),
  //   ]);
  //   await efs.read(fd, buf3, 0, 20);
  //   // EncryptedFS.read only reads data after the write stream finishes
  //   expect(buf1.toString()).not.toContain('AB');
  //   expect(buf2.toString()).not.toContain('AB');
  //   expect(buf3.toString()).toContain('AB');
  // });
  // test('one read stream and one fd reading to the same file', async () => {
  //   await efs.writeFile('file', 'AAAAAAAAAABBBBBBBBBB');
  //   const fd = await efs.open('file', constants.O_RDONLY);
  //   const readStream = efs.createReadStream('file');
  //   let readData = '';
  //   readStream.on('data', (data) => {
  //     readData += data;
  //   });
  //   const streamEnd = new Promise((res) => {
  //     readStream.on('end', () => {
  //       res(null);
  //     });
  //   });
  //   const buf = Buffer.alloc(20);
  //   await Promise.all([efs.read(fd, buf, 0, 20), streamEnd]);
  //   await sleep(100);
  //   // Ok, is efs.read() broken?
  //   expect(readData).toContain('AB');
  //   expect(buf.toString()).toContain('AB');
  // });
  // test('two write streams to the same file', async () => {
  //   const contentSize = 4096 * 3;
  //   const contents = [
  //     'A'.repeat(contentSize),
  //     'B'.repeat(contentSize),
  //     'C'.repeat(contentSize),
  //   ];
  //   let streams: Array<WriteStream> = [];
  //   // Each stream sequentially
  //   for (let i = 0; i < contents.length; i++) {
  //     streams.push(efs.createWriteStream('file'));
  //   }
  //   for (let i = 0; i < streams.length; i++) {
  //     streams[i].write(Buffer.from(contents[i]));
  //   }
  //   for (const stream of streams) {
  //     stream.end();
  //   }
  //   await sleep(1000);
  //   const fileContents = (await efs.readFile('file')).toString();
  //   expect(fileContents).not.toContain('A');
  //   expect(fileContents).not.toContain('B');
  //   expect(fileContents).toContain('C');
  //   await efs.unlink('file');
  //   // Each stream interlaced
  //   const contents2 = ['A'.repeat(4096), 'B'.repeat(4096), 'C'.repeat(4096)];
  //   streams = [];
  //   for (let i = 0; i < contents2.length; i++) {
  //     streams.push(efs.createWriteStream('file'));
  //   }
  //   for (let j = 0; j < 3; j++) {
  //     for (let i = 0; i < streams.length; i++) {
  //       // Order we write to changes.
  //       streams[(j + i) % 3].write(Buffer.from(contents2[(j + i) % 3]));
  //     }
  //   }
  //   for (const stream of streams) {
  //     stream.end();
  //   }
  //   await sleep(1000);
  //   const fileContents2 = (await efs.readFile('file')).toString();
  //   expect(fileContents2).not.toContain('A');
  //   expect(fileContents2).not.toContain('B');
  //   expect(fileContents2).toContain('C');
  //   // The last stream to close writes the whole contents of it's buffer to the file
  // });
  // test('writing a file and deleting the file at the same time using writeFile', async () => {
  //   await efs.writeFile('file', '');
  //   // Odd error, needs fixing.
  //   await Promise.all([efs.writeFile('file', 'CONTENT!'), efs.unlink('file')]);
  //   await expectError(
  //     efs.readFile('file'),
  //     ErrorEncryptedFSError,
  //     errno.ENOENT,
  //   );
  // });
  // test('opening a file and deleting the file at the same time', async () => {
  //   await efs.writeFile('file', '');

  //   // Odd error, needs fixing.
  //   const results = await Promise.all([
  //     efs.open('file', constants.O_WRONLY),
  //     efs.unlink('file'),
  //   ]);
  //   const fd = results[0];
  //   await efs.write(fd, 'yooo');
  // });
  // test('writing a file and deleting the file at the same time for fd', async () => {
  //   await efs.writeFile('file', '');
  //   const fd1 = await efs.open('file', constants.O_WRONLY);
  //   await Promise.all([
  //     efs.write(fd1, Buffer.from('TESTING WOOo')),
  //     efs.unlink('file'),
  //   ]);
  //   await efs.close(fd1);
  //   expect(await efs.readdir('.')).toEqual([]);
  //   await efs.writeFile('file', '');
  //   const fd2 = await efs.open('file', constants.O_WRONLY);
  //   await Promise.all([
  //     efs.unlink('file'),
  //     efs.write(fd2, Buffer.from('TESTING TWOOo')),
  //   ]);
  //   await efs.close(fd2);
  //   expect(await efs.readdir('.')).toEqual([]);
  // });
  // test('writing a file and deleting the file at the same time for stream', async () => {
  //   await efs.writeFile('file', '');
  //   const writeStream1 = efs.createWriteStream('file');
  //   await Promise.all([
  //     new Promise((res) => {
  //       writeStream1.write(Buffer.from('AAAAAAAAAA'), () => {
  //         writeStream1.end(() => {
  //           res(null);
  //         });
  //       });
  //     }),
  //     efs.unlink('file'),
  //   ]);
  //   expect(await efs.readdir('.')).toEqual([]);
  //   await efs.writeFile('file', '');
  //   const writeStream2 = efs.createWriteStream('file');
  //   await Promise.all([
  //     efs.unlink('file'),
  //     new Promise((res) => {
  //       writeStream2.write(Buffer.from('BBBBBBBBBB'), () => {
  //         writeStream2.end(() => {
  //           res(null);
  //         });
  //       });
  //     }),
  //   ]);
  //   expect(await efs.readdir('.')).toEqual([]);
  // });
  // test('appending to a file that is being written to for fd ', async () => {
  //   await efs.writeFile('file', '');
  //   const fd1 = await efs.open('file', constants.O_WRONLY);
  //   await Promise.all([
  //     efs.write(fd1, Buffer.from('AAAAAAAAAA')),
  //     efs.appendFile('file', 'BBBBBBBBBB'),
  //   ]);
  //   const fileContents = (await efs.readFile('file')).toString();
  //   expect(fileContents).toContain('A');
  //   expect(fileContents).toContain('B');
  //   expect(fileContents).toContain('AB');
  //   await efs.close(fd1);

  //   await efs.writeFile('file', '');
  //   const fd2 = await efs.open('file', constants.O_WRONLY);
  //   await Promise.all([
  //     efs.appendFile('file', 'BBBBBBBBBB'),
  //     efs.write(fd2, Buffer.from('AAAAAAAAAA')),
  //   ]);
  //   // The append seems to happen after the write
  //   const fileContents2 = (await efs.readFile('file')).toString();
  //   expect(fileContents2).toContain('A');
  //   expect(fileContents2).toContain('B');
  //   expect(fileContents2).toContain('AB');
  //   await sleep(1000);
  //   await efs.close(fd2);
  // });
  // test('appending to a file that is being written for stream', async () => {
  //   await efs.writeFile('file', '');
  //   const writeStream = efs.createWriteStream('file');
  //   await Promise.all([
  //     new Promise((resolve) => {
  //       writeStream.write(Buffer.from('AAAAAAAAAA'), () => {
  //         writeStream.end(() => {
  //           resolve(null);
  //         });
  //       });
  //     }),
  //     efs.appendFile('file', 'BBBBBBBBBB'),
  //   ]);
  //   const fileContents = (await efs.readFile('file')).toString();
  //   expect(fileContents).toContain('A');
  //   expect(fileContents).toContain('B');
  //   expect(fileContents).toContain('AB');
  //   await efs.writeFile('file', '');
  //   const writeStream2 = efs.createWriteStream('file');
  //   await Promise.all([
  //     efs.appendFile('file', 'BBBBBBBBBB'),
  //     new Promise((res) => {
  //       writeStream2.write(Buffer.from('AAAAAAAAAA'), () => {
  //         writeStream2.end(() => {
  //           res(null);
  //         });
  //       });
  //     }),
  //   ]);
  //   // Append seems to happen after stream
  //   const fileContents2 = (await efs.readFile('file')).toString();
  //   expect(fileContents2).toContain('A');
  //   expect(fileContents2).toContain('B');
  // });
  // test('copying a file that is being written to for fd', async () => {
  //   await efs.writeFile('file', 'AAAAAAAAAA');
  //   const fd1 = await efs.open('file', constants.O_WRONLY);
  //   await Promise.all([
  //     efs.write(fd1, Buffer.from('BBBBBBBBBB')),
  //     efs.copyFile('file', 'fileCopy'),
  //   ]);
  //   // Gets overwritten before copy
  //   const fileContents = (await efs.readFile('fileCopy')).toString();
  //   expect(fileContents).not.toContain('A');
  //   expect(fileContents).toContain('B');
  //   await efs.close(fd1);
  //   await efs.writeFile('file', 'AAAAAAAAAA');
  //   const fd2 = await efs.open('file', constants.O_WRONLY);
  //   await efs.unlink('fileCopy');
  //   await Promise.all([
  //     efs.copyFile('file', 'fileCopy'),
  //     efs.write(fd2, Buffer.from('BBBBBBBBBB')),
  //   ]);
  //   // Also gets overwritten before copy
  //   const fileContents2 = (await efs.readFile('fileCopy')).toString();
  //   expect(fileContents2).not.toContain('A');
  //   expect(fileContents2).toContain('B');
  // });
  // test('copying a file that is being written to for stream', async () => {
  //   await efs.writeFile('file', 'AAAAAAAAAA');
  //   const writeStream = efs.createWriteStream('file');
  //   await Promise.all([
  //     new Promise((res) => {
  //       writeStream.write(Buffer.from('BBBBBBBBBB'), () => {
  //         writeStream.end(() => {
  //           res(null);
  //         });
  //       });
  //     }),
  //     efs.copyFile('file', 'fileCopy'),
  //   ]);
  //   // Write happens first
  //   const fileContents = (await efs.readFile('fileCopy')).toString();
  //   expect(fileContents).not.toContain('A');
  //   expect(fileContents).toContain('B');
  //   await efs.writeFile('file', 'AAAAAAAAAA');
  //   await efs.unlink('fileCopy');
  //   const writeStream2 = efs.createWriteStream('file');
  //   await Promise.all([
  //     efs.copyFile('file', 'fileCopy'),
  //     new Promise((res) => {
  //       writeStream2.write(Buffer.from('BBBBBBBBBB'), () => {
  //         writeStream2.end(() => {
  //           res(null);
  //         });
  //       });
  //     }),
  //   ]);
  //   // Copy happens after stream
  //   const fileContents2 = (await efs.readFile('fileCopy')).toString();
  //   expect(fileContents2).not.toContain('A');
  //   expect(fileContents2).toContain('B');
  //   await sleep(100);
  // });
});
