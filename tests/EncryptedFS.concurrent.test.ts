import type { FdIndex } from '@/fd/types';
import type { INodeData } from '@/inodes/types';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { code as errno } from 'errno';
import { DB } from '@matrixai/db';
import EncryptedFS from '@/EncryptedFS';
import { ErrorEncryptedFSError } from '@/errors';
import * as utils from '@/utils';
import * as constants from '@/constants';
import INodeManager from '@/inodes/INodeManager';
import { promise } from '@/utils';
import { expectReason, sleep } from './utils';

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
      // @ts-ignore - version of js-logger is incompatible (remove when js-db updates to 5.* here)
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
    test('EncryptedFS.mknod and EncryptedFS.mknod', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.mknod(path1, constants.S_IFREG, 0, 0);
        })(),
        (async () => {
          return await efs.mknod(path1, constants.S_IFREG, 0, 0);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.mknod(path1, constants.S_IFREG, 0, 0);
        })(),
        (async () => {
          return await efs.mknod(path1, constants.S_IFREG, 0, 0);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }
    });
    test('EncryptedFS.mkdir and EncryptedFS.mknod', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.mkdir(path1);
        })(),
        (async () => {
          return await efs.mknod(path1, constants.S_IFREG, 0, 0);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.mkdir(path1);
        })(),
        (async () => {
          return await efs.mknod(path1, constants.S_IFREG, 0, 0);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }
    });
    test('EncryptedFS.open and EncryptedFS.mkdir', async () => {
      const path1 = path.join('dir', 'dir1');
      await efs.mkdir('dir');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.mkdir(path1);
        })(),
        (async () => {
          const fd = await efs.open(path1, 'wx');
          await efs.close(fd);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.mkdir(path1);
        })(),
        (async () => {
          const fd = await efs.open(path1, 'wx');
          await efs.close(fd);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }
    });
    // Test inode creation as well
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
      // Concurrent appends results in mutually exclusive writes
      const promises = [
        efs.appendFile('test', 'one'),
        efs.appendFile('test', 'two'),
      ];
      await Promise.all(promises);
      // Either order of appending is acceptable
      expect(['originalonetwo', 'originaltwoone']).toContainEqual(
        await efs.readFile('test', { encoding: 'utf-8' }),
      );
    });
    test('EncryptedFS.fallocate and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      // WriteFile with path
      let results = await Promise.allSettled([
        (async () => {
          return await efs.fallocate(fd, 0, 100);
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      if (contents.length === 100) {
        // Fallocate happened after write
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(100);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(4);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.fallocate(fd, 0, 100);
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length === 100) {
        // Fallocate happened after write
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(100);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(4);
      }

      // WriteFile with FdIndex
      // cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          return await efs.fallocate(fd, 0, 100);
        })(),
        (async () => {
          return await efs.writeFile(fd, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length === 100) {
        // Fallocate happened after write
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(100);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(4);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.fallocate(fd, 0, 100);
        })(),
        (async () => {
          return await efs.writeFile(fd, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length === 100) {
        // Fallocate happened after write
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(100);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(4);
      }
    });
    test('EncryptedFS.fallocate and EncryptedFS.write', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      // WriteFile with path
      let results = await Promise.allSettled([
        (async () => {
          return await efs.fallocate(fd, 0, 100);
        })(),
        (async () => {
          return await efs.write(fd, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 4 },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      if (contents.length === 100) {
        // Fallocate happened after write
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(100);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(4);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.fallocate(fd, 0, 100);
        })(),
        (async () => {
          return await efs.write(fd, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 4 },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length === 100) {
        // Fallocate happened after write
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(100);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(4);
      }
    });
    test('EncryptedFS.fallocate and EncryptedFS.createWriteStream', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      // WriteFile with path
      let results = await Promise.allSettled([
        (async () => {
          return await efs.fallocate(fd, 0, 100);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(i.toString());
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      if (contents.length === 100) {
        // Fallocate happened after write
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(100);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(10);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.fallocate(fd, 0, 100);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(i.toString());
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length === 100) {
        // Fallocate happened after write
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(100);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(10);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      // With a slow streaming write,
      //  fallocate should happen in the middle of the stream
      results = await Promise.allSettled([
        (async () => {
          await sleep(50);
          return await efs.fallocate(fd, 0, 100);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(i.toString());
            await sleep(10);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length === 100) {
        // Fallocate happened after write
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(100);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(100);
        expect(contents.length).toEqual(10);
      }
    });
    test('EncryptedFS.truncate and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      // WriteFile with path
      let results = await Promise.allSettled([
        (async () => {
          return await efs.truncate(fd, 27);
        })(),
        (async () => {
          return await efs.writeFile(
            path1,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      if (contents.length < 30) {
        // Write happened after fallocate
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      } else {
        // Fallocate happened after write
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.truncate(fd, 27);
        })(),
        (async () => {
          return await efs.writeFile(
            path1,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length < 30) {
        // Write happened after fallocate
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      } else {
        // Fallocate happened after write
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      }

      // WriteFile with FdIndex
      // cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          return await efs.truncate(fd, 27);
        })(),
        (async () => {
          return await efs.writeFile(
            fd,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length < 30) {
        // Write happened after fallocate
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      } else {
        // Fallocate happened after write
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.truncate(fd, 27);
        })(),
        (async () => {
          return await efs.writeFile(
            fd,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length < 30) {
        // Write happened after fallocate
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      } else {
        // Fallocate happened after write
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      }
    });
    test('EncryptedFS.truncate and EncryptedFS.write', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      // WriteFile with path
      let results = await Promise.allSettled([
        (async () => {
          return await efs.truncate(fd, 27);
        })(),
        (async () => {
          return await efs.write(
            fd,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 44 },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      if (contents.length > 30) {
        // Fallocate happened after write
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.truncate(fd, 27);
        })(),
        (async () => {
          return await efs.write(
            fd,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 44 },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length > 30) {
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      } else {
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      }
    });
    test('EncryptedFS.truncate and EncryptedFS.createWriteStream', async () => {
      const path1 = path.join('dir', 'file1');
      const phrase = 'The quick brown fox jumped over the lazy dog'.split(' ');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      // WriteFile with path
      let results = await Promise.allSettled([
        (async () => {
          return await efs.truncate(fd, 27);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (const i of phrase) {
            writeStream.write(i + ' ');
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      if (contents.length > 30) {
        expect(stat.size).toEqual(45);
        expect(contents.length).toEqual(45);
      } else {
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.truncate(fd, 27);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (const i of phrase) {
            writeStream.write(i + ' ');
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length > 30) {
        expect(stat.size).toEqual(45);
        expect(contents.length).toEqual(45);
      } else {
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(50);
          return await efs.truncate(fd, 27);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (const i of phrase) {
            writeStream.write(i + ' ');
            await sleep(10);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length > 30) {
        expect(stat.size).toEqual(45);
        expect(contents.length).toEqual(45);
      } else {
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      }
    });
    test('EncryptedFS.ftruncate and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      // WriteFile with path
      let results = await Promise.allSettled([
        (async () => {
          return await efs.ftruncate(fd, 27);
        })(),
        (async () => {
          return await efs.writeFile(
            path1,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      if (contents.length < 30) {
        // Write happened after fallocate
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      } else {
        // Fallocate happened after write
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.ftruncate(fd, 27);
        })(),
        (async () => {
          return await efs.writeFile(
            path1,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length < 30) {
        // Write happened after fallocate
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      } else {
        // Fallocate happened after write
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      }

      // WriteFile with FdIndex
      // cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          return await efs.ftruncate(fd, 27);
        })(),
        (async () => {
          return await efs.writeFile(
            fd,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length < 30) {
        // Write happened after fallocate
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      } else {
        // Fallocate happened after write
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.ftruncate(fd, 27);
        })(),
        (async () => {
          return await efs.writeFile(
            fd,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length < 30) {
        // Write happened after fallocate
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      } else {
        // Fallocate happened after write
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      }
    });
    test('EncryptedFS.ftruncate and EncryptedFS.write', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      // WriteFile with path
      let results = await Promise.allSettled([
        (async () => {
          return await efs.ftruncate(fd, 27);
        })(),
        (async () => {
          return await efs.write(
            fd,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 44 },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      if (contents.length > 30) {
        // Fallocate happened after write
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      } else {
        // Write happened after fallocate
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.ftruncate(fd, 27);
        })(),
        (async () => {
          return await efs.write(
            fd,
            'The quick brown fox jumped over the lazy dog',
          );
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 44 },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length > 30) {
        expect(stat.size).toEqual(44);
        expect(contents.length).toEqual(44);
      } else {
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      }
    });
    test('EncryptedFS.ftruncate and EncryptedFS.createWriteStream', async () => {
      const path1 = path.join('dir', 'file1');
      const phrase = 'The quick brown fox jumped over the lazy dog'.split(' ');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      // WriteFile with path
      let results = await Promise.allSettled([
        (async () => {
          return await efs.ftruncate(fd, 27);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (const i of phrase) {
            writeStream.write(i + ' ');
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      if (contents.length > 30) {
        expect(stat.size).toEqual(45);
        expect(contents.length).toEqual(45);
      } else {
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.ftruncate(fd, 27);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (const i of phrase) {
            writeStream.write(i + ' ');
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length > 30) {
        expect(stat.size).toEqual(45);
        expect(contents.length).toEqual(45);
      } else {
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(50);
          return await efs.ftruncate(fd, 27);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (const i of phrase) {
            writeStream.write(i + ' ');
            await sleep(10);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length > 30) {
        expect(stat.size).toEqual(45);
        expect(contents.length).toEqual(45);
      } else {
        expect(stat.size).toEqual(27);
        expect(contents.length).toEqual(27);
      }
    });
    test('EncryptedFS.utimes and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'file1');
      const nowTime = Date.now();
      await sleep(10);
      await efs.mkdir('dir');
      await efs.writeFile(path1, 'test');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.utimes(path1, 0, 0);
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      if (stat.mtime.getTime() === 0) {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toEqual(0);
      } else {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toBeGreaterThan(nowTime);
      }

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.utimes(path1, 0, 0);
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      if (stat.mtime.getTime() === 0) {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toEqual(0);
      } else {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toBeGreaterThan(nowTime);
      }
    });
    test('EncryptedFS.futimes and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'file1');
      const nowTime = Date.now();
      await sleep(10);
      await efs.mkdir('dir');
      const fd = await efs.open(path1, 'wx+');
      await efs.writeFile(fd, 'test');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.futimes(fd, 0, 0);
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      if (stat.mtime.getTime() === 0) {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toEqual(0);
      } else {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toBeGreaterThan(nowTime);
      }

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.futimes(fd, 0, 0);
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      if (stat.mtime.getTime() === 0) {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toEqual(0);
      } else {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toBeGreaterThan(nowTime);
      }
      await efs.close(fd);
    });
    test('EncryptedFS.utimes a directory and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'dir1');
      const path2 = path.join(path1, 'file1');
      const nowTime = Date.now();
      await sleep(10);
      await efs.mkdir('dir');
      await efs.mkdir(path1);
      await efs.writeFile(path2, 'test');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.utimes(path1, 0, 0);
        })(),
        (async () => {
          return await efs.writeFile(path2, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      if (stat.mtime.getTime() === 0) {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toEqual(0);
      } else {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toBeGreaterThan(nowTime);
      }

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.utimes(path1, 0, 0);
        })(),
        (async () => {
          return await efs.writeFile(path2, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      if (stat.mtime.getTime() === 0) {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toEqual(0);
      } else {
        expect(stat.atime.getTime()).toEqual(0);
        expect(stat.mtime.getTime()).toBeGreaterThan(nowTime);
      }
    });
    test('EncryptedFS.lseek and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.lseek(fd, 20, constants.SEEK_CUR);
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: 20 },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      expect(stat.size).toEqual(4);
      expect(contents.length).toEqual(4);

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.lseek(fd, 20, constants.SEEK_CUR);
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: 20 },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      expect(stat.size).toEqual(4);
      expect(contents.length).toEqual(4);
    });
    test('EncryptedFS.lseek and EncryptedFS.writeFile with fd', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.lseek(fd, 20, constants.SEEK_CUR);
        })(),
        (async () => {
          return await efs.writeFile(fd, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: 20 },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      expect(stat.size).toEqual(4);
      expect(contents.length).toEqual(4);

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.lseek(fd, 20, constants.SEEK_CUR);
        })(),
        (async () => {
          return await efs.writeFile(fd, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: 20 },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      expect(stat.size).toEqual(4);
      expect(contents.length).toEqual(4);
    });
    test('EncryptedFS.lseek and EncryptedFS.write', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.lseek(fd, 20, constants.SEEK_CUR);
        })(),
        (async () => {
          return await efs.write(fd, 'test');
        })(),
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      if (contents.length > 15) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 20 },
          { status: 'fulfilled', value: 4 },
        ]);
        expect(stat.size).toEqual(24);
        expect(contents.length).toEqual(24);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 24 },
          { status: 'fulfilled', value: 4 },
        ]);
        expect(stat.size).toEqual(4);
        expect(contents.length).toEqual(4);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.lseek(fd, 20, constants.SEEK_CUR);
        })(),
        (async () => {
          return await efs.write(fd, 'test');
        })(),
      ]);

      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      if (contents.length > 15) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 20 },
          { status: 'fulfilled', value: 4 },
        ]);
        expect(stat.size).toEqual(24);
        expect(contents.length).toEqual(24);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 24 },
          { status: 'fulfilled', value: 4 },
        ]);
        expect(stat.size).toEqual(4);
        expect(contents.length).toEqual(4);
      }
    });
    test('EncryptedFS.lseek and EncryptedFS.readFile', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');
      await efs.writeFile(path1, 'test');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.lseek(fd, 20, constants.SEEK_CUR);
        })(),
        (async () => {
          return (await efs.readFile(path1)).toString();
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: 20 },
        { status: 'fulfilled', value: 'test' },
      ]);
      let stat = await efs.stat(path1);
      let contents = await efs.readFile(path1);
      expect(stat.size).toEqual(4);
      expect(contents.length).toEqual(4);

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');
      await efs.writeFile(path1, 'test');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.lseek(fd, 20, constants.SEEK_CUR);
        })(),
        (async () => {
          return (await efs.readFile(path1)).toString();
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: 20 },
        { status: 'fulfilled', value: 'test' },
      ]);
      stat = await efs.stat(path1);
      contents = await efs.readFile(path1);
      expect(stat.size).toEqual(4);
      expect(contents.length).toEqual(4);
    });
    test('EncryptedFS.lseek and EncryptedFS.read', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      await efs.writeFile(
        path1,
        'The quick brown fox jumped over the lazy dog',
      );
      let fd = await efs.open(path1, 'r+');

      const buffer = Buffer.alloc(45);
      let results = await Promise.allSettled([
        (async () => {
          return await efs.lseek(fd, 27, constants.SEEK_CUR);
        })(),
        (async () => {
          return await efs.read(fd, buffer, undefined, 44);
        })(),
      ]);
      if (results[1].status === 'fulfilled' && results[1].value > 30) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 71 },
          { status: 'fulfilled', value: 44 },
        ]);
        expect(buffer.toString()).toContain('The quick brown fox');
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 27 },
          { status: 'fulfilled', value: 17 },
        ]);
        expect(buffer.toString()).not.toContain('The quick brown fox');
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(
        path1,
        'The quick brown fox jumped over the lazy dog',
      );
      fd = await efs.open(path1, 'r+');
      buffer.fill(0);

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.lseek(fd, 27, constants.SEEK_CUR);
        })(),
        (async () => {
          return await efs.read(fd, buffer, undefined, 44);
        })(),
      ]);
      if (results[1].status === 'fulfilled' && results[1].value > 30) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 71 },
          { status: 'fulfilled', value: 44 },
        ]);
        expect(buffer.toString()).toContain('The quick brown fox');
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 27 },
          { status: 'fulfilled', value: 17 },
        ]);
        expect(buffer.toString()).not.toContain('The quick brown fox');
      }
    });
    test('EncryptedFS.lseek and EncryptedFS.lseek setting position', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      let fd = await efs.open(path1, 'wx+');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.lseek(fd, 20, constants.SEEK_CUR);
        })(),
        (async () => {
          return await efs.lseek(fd, 15, constants.SEEK_SET);
        })(),
      ]);
      let pos = await efs.lseek(fd, 0, constants.SEEK_CUR);
      if (pos > 30) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 35 },
          { status: 'fulfilled', value: 15 },
        ]);
        expect(pos).toEqual(35);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 20 },
          { status: 'fulfilled', value: 15 },
        ]);
        expect(pos).toEqual(15);
      }

      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      fd = await efs.open(path1, 'wx+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.lseek(fd, 20, constants.SEEK_CUR);
        })(),
        (async () => {
          return await efs.lseek(fd, 15, constants.SEEK_SET);
        })(),
      ]);
      pos = await efs.lseek(fd, 0, constants.SEEK_CUR);
      if (pos > 30) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 35 },
          { status: 'fulfilled', value: 15 },
        ]);
        expect(pos).toEqual(35);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 20 },
          { status: 'fulfilled', value: 15 },
        ]);
        expect(pos).toEqual(15);
      }
    });
    test('EncryptedFS.createReadStream and EncryptedFS.createWriteStream', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB'.repeat(5);
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataB);

      let results = await Promise.allSettled([
        (async () => {
          const readProm = new Promise<string>((resolve, reject) => {
            const readStream = efs.createReadStream(path1);
            let readData = '';
            readStream.on('data', (data) => {
              readData += data.toString();
            });
            readStream.on('end', () => {
              resolve(readData);
            });
            readStream.on('error', (e) => {
              reject(e);
            });
          });
          return await readProm;
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);

      if (results[0].status === 'fulfilled' && results[0].value[0] === 'A') {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataA.repeat(10) },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB },
          { status: 'fulfilled', value: undefined },
        ]);
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataB);

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          const readProm = new Promise<string>((resolve, reject) => {
            const readStream = efs.createReadStream(path1);
            let readData = '';
            readStream.on('data', (data) => {
              readData += data.toString();
            });
            readStream.on('end', () => {
              resolve(readData);
            });
            readStream.on('error', (e) => {
              reject(e);
            });
          });
          return await readProm;
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);

      if (results[0].status === 'fulfilled' && results[0].value[0] === 'A') {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataA.repeat(10) },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB },
          { status: 'fulfilled', value: undefined },
        ]);
      }
    });
    test('EncryptedFS.write and EncryptedFS.createWriteStream', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB'.repeat(5);
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      let fd = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          return efs.write(fd, dataB);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: 25 },
        { status: 'fulfilled', value: undefined },
      ]);
      let stat = await efs.stat(path1);
      let contents = (await efs.readFile(path1)).toString();

      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA.repeat(10));
        expect(contents).toHaveLength(50);
        expect(stat.size).toEqual(50);
      } else {
        expect(contents).toEqual(dataB + dataA.repeat(5));
        expect(contents).toHaveLength(50);
        expect(stat.size).toEqual(50);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return efs.write(fd, dataB);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: 25 },
        { status: 'fulfilled', value: undefined },
      ]);
      stat = await efs.stat(path1);
      contents = (await efs.readFile(path1)).toString();

      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA.repeat(10));
        expect(contents).toHaveLength(50);
        expect(stat.size).toEqual(50);
      } else {
        expect(contents).toEqual(dataB + dataA.repeat(5));
        expect(contents).toHaveLength(50);
        expect(stat.size).toEqual(50);
      }
    });
    test('EncryptedFS.createReadStream and EncryptedFS.write', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB'.repeat(5);
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataB);
      let fd = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          const readProm = new Promise<string>((resolve, reject) => {
            const readStream = efs.createReadStream(path1);
            let readData = '';
            readStream.on('data', (data) => {
              readData += data.toString();
            });
            readStream.on('end', () => {
              resolve(readData);
            });
            readStream.on('error', (e) => {
              reject(e);
            });
          });
          return await readProm;
        })(),
        (async () => {
          await efs.write(fd, dataA);
        })(),
      ]);

      if (results[0].status === 'fulfilled' && results[0].value[0] === 'A') {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataA + dataB.slice(dataA.length) },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB },
          { status: 'fulfilled', value: undefined },
        ]);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataB);
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          const readProm = new Promise<string>((resolve, reject) => {
            const readStream = efs.createReadStream(path1);
            let readData = '';
            readStream.on('data', (data) => {
              readData += data.toString();
            });
            readStream.on('end', () => {
              resolve(readData);
            });
            readStream.on('error', (e) => {
              reject(e);
            });
          });
          return await readProm;
        })(),
        (async () => {
          await efs.write(fd, dataA);
        })(),
      ]);

      if (results[0].status === 'fulfilled' && results[0].value[0] === 'A') {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataA + dataB.slice(dataA.length) },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB },
          { status: 'fulfilled', value: undefined },
        ]);
      }
    });
    test('EncryptedFS.read and EncryptedFS.createWriteStream', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'AAAAA';
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      let fd = await efs.open(path1, 'r+');
      const buffer = Buffer.alloc(100);

      let results = await Promise.allSettled([
        (async () => {
          return efs.read(fd, buffer, undefined, 100);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      let contents = buffer.toString();

      if (results[0].status === 'fulfilled' && results[0].value === 50) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 50 },
          { status: 'fulfilled', value: undefined },
        ]);
        expect(contents).toEqual(dataA.repeat(10) + '\0'.repeat(50));
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 0 },
          { status: 'fulfilled', value: undefined },
        ]);
        expect(contents).toEqual('\0'.repeat(100));
      }

      // Cleaning up
      buffer.fill(0);
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return efs.read(fd, buffer, undefined, 100);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      contents = buffer.toString();

      if (results[0].status === 'fulfilled' && results[0].value === 50) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 50 },
          { status: 'fulfilled', value: undefined },
        ]);
        expect(contents).toEqual(dataA.repeat(10) + '\0'.repeat(50));
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: 0 },
          { status: 'fulfilled', value: undefined },
        ]);
        expect(contents).toEqual('\0'.repeat(100));
      }
    });
    test('EncryptedFS.createReadStream and EncryptedFS.read', async () => {
      const path1 = path.join('dir', 'file1');
      const dataB = 'BBBBB'.repeat(5);
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataB);
      const buffer = Buffer.alloc(100);
      let fd = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          const readProm = new Promise<string>((resolve, reject) => {
            const readStream = efs.createReadStream(path1);
            let readData = '';
            readStream.on('data', (data) => {
              readData += data.toString();
            });
            readStream.on('end', () => {
              resolve(readData);
            });
            readStream.on('error', (e) => {
              reject(e);
            });
          });
          return await readProm;
        })(),
        (async () => {
          return efs.read(fd, buffer, undefined, 100);
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: dataB },
        { status: 'fulfilled', value: 25 },
      ]);

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataB);
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          const readProm = new Promise<string>((resolve, reject) => {
            const readStream = efs.createReadStream(path1);
            let readData = '';
            readStream.on('data', (data) => {
              readData += data.toString();
            });
            readStream.on('end', () => {
              resolve(readData);
            });
            readStream.on('error', (e) => {
              reject(e);
            });
          });
          return await readProm;
        })(),
        (async () => {
          return efs.read(fd, buffer, undefined, 100);
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: dataB },
        { status: 'fulfilled', value: 25 },
      ]);
    });
    test('EncryptedFS.createWriteStream and EncryptedFS.createWriteStream', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB';
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      let results = await Promise.allSettled([
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataB);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      let stat = await efs.stat(path1);
      let contents = (await efs.readFile(path1)).toString();
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA.repeat(10));
        expect(contents).toHaveLength(50);
        expect(stat.size).toEqual(50);
      } else {
        expect(contents).toEqual(dataB.repeat(10));
        expect(contents).toHaveLength(50);
        expect(stat.size).toEqual(50);
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataB);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      stat = await efs.stat(path1);
      contents = (await efs.readFile(path1)).toString();
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA.repeat(10));
        expect(contents).toHaveLength(50);
        expect(stat.size).toEqual(50);
      } else {
        expect(contents).toEqual(dataB.repeat(10));
        expect(contents).toHaveLength(50);
        expect(stat.size).toEqual(50);
      }
    });
    test('EncryptedFS.unlink and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.unlink(path1);
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if ((await efs.exists(path1)) === true) {
        expect(await efs.exists(path1)).toEqual(true);
        expect((await efs.readFile(path1)).toString()).toEqual('test');
      } else {
        expect(await efs.exists(path1)).toEqual(false);
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.unlink(path1);
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if ((await efs.exists(path1)) === true) {
        expect(await efs.exists(path1)).toEqual(true);
        expect((await efs.readFile(path1)).toString()).toEqual('test');
      } else {
        expect(await efs.exists(path1)).toEqual(false);
      }
    });
    test('EncryptedFS.unlink and EncryptedFS.open', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.unlink(path1);
        })(),
        (async () => {
          const fd = await efs.open(path1, 'r+');
          await efs.close(fd);
          return fd;
        })(),
      ]);
      if (
        results[0].status === 'fulfilled' &&
        results[1].status === 'rejected'
      ) {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.ENOENT);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: undefined },
          { status: 'fulfilled', value: 0 },
        ]);
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.unlink(path1);
        })(),
        (async () => {
          const fd = await efs.open(path1, 'r+');
          await efs.close(fd);
          return fd;
        })(),
      ]);
      if (
        results[0].status === 'fulfilled' &&
        results[1].status === 'rejected'
      ) {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.ENOENT);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: undefined },
          { status: 'fulfilled', value: 0 },
        ]);
      }
    });
    test('EncryptedFS.unlink and EncryptedFS.write', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      let fd = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.unlink(path1);
        })(),
        (async () => {
          return await efs.write(fd, 'test');
        })(),
      ]);
      await efs.close(fd);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 4 },
      ]);
      expect(await efs.exists(path1)).toEqual(false);

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.unlink(path1);
        })(),
        (async () => {
          return await efs.write(fd, 'test');
        })(),
      ]);
      await efs.close(fd);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 4 },
      ]);
      expect(await efs.exists(path1)).toEqual(false);
    });
    test('EncryptedFS.unlink and EncryptedFS.createWriteStream', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'AAAAA';
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.unlink(path1);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (await efs.exists(path1)) {
        const stat = await efs.stat(path1);
        const contents = (await efs.readFile(path1)).toString();
        expect(contents).toEqual(dataA.repeat(10));
        expect(stat.size).toEqual(50);
      } else {
        expect(await efs.exists(path1)).toEqual(false);
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.unlink(path1);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (await efs.exists(path1)) {
        const stat = await efs.stat(path1);
        const contents = (await efs.readFile(path1)).toString();
        expect(contents).toEqual(dataA.repeat(10));
        expect(stat.size).toEqual(50);
      } else {
        expect(await efs.exists(path1)).toEqual(false);
      }
    });
    test('EncryptedFS.appendFIle and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'A'.repeat(10);
      const dataB = 'B'.repeat(10);
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.appendFile(path1, dataA);
        })(),
        (async () => {
          return await efs.writeFile(path1, dataB);
        })(),
      ]);
      let stat = await efs.stat(path1);
      let contents = (await efs.readFile(path1)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (stat.size > 15) {
        expect(contents).toEqual(dataB + dataA);
        expect(stat.size).toEqual(20);
      } else {
        expect(contents).toEqual(dataB);
        expect(stat.size).toEqual(10);
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.appendFile(path1, dataA);
        })(),
        (async () => {
          return await efs.writeFile(path1, dataB);
        })(),
      ]);
      stat = await efs.stat(path1);
      contents = (await efs.readFile(path1)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (stat.size > 15) {
        // Expected BB..BBAA..AA
        expect(contents).toEqual(dataB + dataA);
        expect(stat.size).toEqual(20);
      } else {
        expect(contents).toEqual(dataB);
        expect(stat.size).toEqual(10);
      }
    });
    test('EncryptedFS.appendFIle and EncryptedFS.writeFile with fd', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'A'.repeat(10);
      const dataB = 'B'.repeat(10);
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      let fd = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.appendFile(fd, dataA);
        })(),
        (async () => {
          return await efs.writeFile(fd, dataB);
        })(),
      ]);
      let stat = await efs.stat(path1);
      let contents = (await efs.readFile(path1)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (stat.size > 15) {
        expect(contents).toEqual(dataB + dataA);
        expect(stat.size).toEqual(20);
      } else {
        expect(contents).toEqual(dataB);
        expect(stat.size).toEqual(10);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.appendFile(fd, dataA);
        })(),
        (async () => {
          return await efs.writeFile(fd, dataB);
        })(),
      ]);
      stat = await efs.stat(path1);
      contents = (await efs.readFile(path1)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (stat.size > 15) {
        expect(contents).toEqual(dataB + dataA);
        expect(stat.size).toEqual(20);
      } else {
        expect(contents).toEqual(dataB);
        expect(stat.size).toEqual(10);
      }
    });
    test('EncryptedFS.appendFIle and EncryptedFS.write', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'A'.repeat(10);
      const dataB = 'B'.repeat(10);
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      let fd = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.appendFile(fd, dataA);
        })(),
        (async () => {
          return await efs.write(fd, dataB);
        })(),
      ]);
      let stat = await efs.stat(path1);
      let contents = (await efs.readFile(path1)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 10 },
      ]);
      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA + dataB);
        expect(stat.size).toEqual(20);
      } else {
        expect(contents).toEqual(dataB + dataA);
        expect(stat.size).toEqual(20);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.appendFile(fd, dataA);
        })(),
        (async () => {
          return await efs.write(fd, dataB);
        })(),
      ]);
      stat = await efs.stat(path1);
      contents = (await efs.readFile(path1)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 10 },
      ]);
      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA + dataB);
        expect(stat.size).toEqual(20);
      } else {
        expect(contents).toEqual(dataB + dataA);
        expect(stat.size).toEqual(20);
      }
    });
    test('EncryptedFS.appendFIle and EncryptedFS.createReadStream', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBBBBBBBBBBBBBBBBB';
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.appendFile(path1, dataB);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      let stat = await efs.stat(path1);
      let contents = (await efs.readFile(path1)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (contents.length > 55) {
        expect(contents).toEqual(dataA.repeat(10) + dataB);
        expect(stat.size).toEqual(70);
      } else {
        expect(contents).toEqual(dataA.repeat(10));
        expect(stat.size).toEqual(50);
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.appendFile(path1, dataB);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      stat = await efs.stat(path1);
      contents = (await efs.readFile(path1)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (contents.length > 55) {
        expect(contents).toEqual(dataA.repeat(10) + dataB);
        expect(stat.size).toEqual(70);
      } else {
        expect(contents).toEqual(dataA.repeat(10));
        expect(stat.size).toEqual(50);
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(50);
          return await efs.appendFile(path1, dataB);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
            await sleep(10);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      stat = await efs.stat(path1);
      contents = (await efs.readFile(path1)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (contents.length > 51) {
        expect(contents).toContain(dataA[0]);
        expect(contents).toContain(dataB[0]);
        expect(stat.size).toBeGreaterThanOrEqual(50);
      } else {
        expect(contents).toContain(dataA[0]);
        expect(contents).not.toContain(dataB[0]);
        expect(stat.size).toEqual(50);
      }
    });
    test('EncryptedFS.copyFile and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'file1');
      const path2 = path.join('dir', 'file2');
      const dataA = 'A'.repeat(10);
      const dataB = 'B'.repeat(10);
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);

      let results = await Promise.allSettled([
        (async () => {
          return await efs.copyFile(path1, path2);
        })(),
        (async () => {
          return await efs.writeFile(path1, dataB);
        })(),
      ]);
      let stat = await efs.stat(path2);
      let contents = (await efs.readFile(path2)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA);
        expect(stat.size).toEqual(10);
      } else {
        expect(contents).toEqual(dataB);
        expect(stat.size).toEqual(10);
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.copyFile(path1, path2);
        })(),
        (async () => {
          return await efs.writeFile(path1, dataB);
        })(),
      ]);
      stat = await efs.stat(path2);
      contents = (await efs.readFile(path2)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA);
        expect(stat.size).toEqual(10);
      } else {
        expect(contents).toEqual(dataB);
        expect(stat.size).toEqual(10);
      }
    });
    test('EncryptedFS.copyFile and EncryptedFS.writeFile with fd', async () => {
      const path1 = path.join('dir', 'file1');
      const path2 = path.join('dir', 'file2');
      const dataA = 'A'.repeat(10);
      const dataB = 'B'.repeat(10);
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);
      let fd = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.copyFile(path1, path2);
        })(),
        (async () => {
          return await efs.writeFile(fd, dataB);
        })(),
      ]);
      let stat = await efs.stat(path2);
      let contents = (await efs.readFile(path2)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA);
        expect(stat.size).toEqual(10);
      } else {
        expect(contents).toEqual(dataB);
        expect(stat.size).toEqual(10);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.copyFile(path1, path2);
        })(),
        (async () => {
          return await efs.writeFile(fd, dataB);
        })(),
      ]);
      stat = await efs.stat(path2);
      contents = (await efs.readFile(path2)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA);
        expect(stat.size).toEqual(10);
      } else {
        expect(contents).toEqual(dataB);
        expect(stat.size).toEqual(10);
      }
    });
    test('EncryptedFS.copyFile and EncryptedFS.write', async () => {
      const path1 = path.join('dir', 'file1');
      const path2 = path.join('dir', 'file2');
      const dataA = 'A'.repeat(10);
      const dataB = 'B'.repeat(10);
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);
      let fd = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.copyFile(path1, path2);
        })(),
        (async () => {
          return await efs.write(fd, dataB);
        })(),
      ]);
      let stat = await efs.stat(path2);
      let contents = (await efs.readFile(path2)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 10 },
      ]);
      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA);
        expect(stat.size).toEqual(10);
      } else {
        expect(contents).toEqual(dataB);
        expect(stat.size).toEqual(10);
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.copyFile(path1, path2);
        })(),
        (async () => {
          return await efs.write(fd, dataB);
        })(),
      ]);
      stat = await efs.stat(path2);
      contents = (await efs.readFile(path2)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: 10 },
      ]);
      if (contents[0] === 'A') {
        expect(contents).toEqual(dataA);
        expect(stat.size).toEqual(10);
      } else {
        expect(contents).toEqual(dataB);
        expect(stat.size).toEqual(10);
      }
    });
    test('EncryptedFS.copyFile and EncryptedFS.createWriteStream', async () => {
      const path1 = path.join('dir', 'file1');
      const path2 = path.join('dir', 'file2');
      const dataA = 'AAAAA';
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.copyFile(path1, path2);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      let stat = await efs.stat(path2);
      let contents = (await efs.readFile(path2)).toString();
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      // All A, in multiples of 5
      expect(contents).toMatch(RegExp('^[^A]*((AAAAA)+[^A]*)$'));
      // Contents length between 0 and 10*5
      expect(contents.length).toBeGreaterThanOrEqual(0);
      expect(contents.length).toBeLessThanOrEqual(50);
      expect(stat.size).toBeGreaterThanOrEqual(0);
      expect(stat.size).toBeLessThanOrEqual(50);

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.copyFile(path1, path2);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      stat = await efs.stat(path2);
      contents = (await efs.readFile(path2)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      // All A, in multiples of 5
      expect(contents).toMatch(RegExp('^[^A]*((AAAAA)+[^A]*)$'));
      // Contents length between 0 and 10*5
      expect(contents.length).toBeGreaterThanOrEqual(0);
      expect(contents.length).toBeLessThanOrEqual(50);
      expect(stat.size).toBeGreaterThanOrEqual(0);
      expect(stat.size).toBeLessThanOrEqual(50);

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(50);
          return await efs.copyFile(path1, path2);
        })(),
        (async () => {
          const writeStream = efs.createWriteStream(path1);
          for (let i = 0; i < 10; i++) {
            writeStream.write(dataA);
            await sleep(10);
          }
          writeStream.end();
          const endProm = promise<void>();
          writeStream.on('finish', () => endProm.resolveP());
          await endProm.p;
        })(),
      ]);
      stat = await efs.stat(path2);
      contents = (await efs.readFile(path2)).toString();

      expect(results).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      // All A, in multiples of 5
      expect(contents).toMatch(RegExp('^[^A]*((AAAAA)+[^A]*)$'));
      // Contents length between 0 and 10*5
      expect(contents.length).toBeGreaterThanOrEqual(0);
      expect(contents.length).toBeLessThanOrEqual(50);
      expect(stat.size).toBeGreaterThanOrEqual(0);
      expect(stat.size).toBeLessThanOrEqual(50);
    });
    test('EncryptedFS.readFile and EncryptedFS.writeFile', async () => {
      const path1 = path.join('dir', 'file1');
      await efs.mkdir('dir');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB';
      await efs.writeFile(path1, dataA);

      let results = await Promise.allSettled([
        (async () => {
          return await efs.writeFile(path1, dataB);
        })(),
        (async () => {
          return (await efs.readFile(path1)).toString();
        })(),
      ]);

      if (results[1].status === 'fulfilled' && results[1].value[0] === 'A') {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: undefined },
          { status: 'fulfilled', value: dataA },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: undefined },
          { status: 'fulfilled', value: dataB },
        ]);
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.writeFile(path1, dataB);
        })(),
        (async () => {
          return (await efs.readFile(path1)).toString();
        })(),
      ]);

      if (results[1].status === 'fulfilled' && results[1].value[0] === 'A') {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: undefined },
          { status: 'fulfilled', value: dataA },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: undefined },
          { status: 'fulfilled', value: dataB },
        ]);
      }
    });
    test('EncryptedFS.read and EncryptedFS.write with different fd', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB';
      const buffer = Buffer.alloc(100);
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);
      let fd1 = await efs.open(path1, 'r+');
      let fd2 = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          // Await sleep(100);
          return await efs.write(fd1, dataB);
        })(),
        (async () => {
          return await efs.read(fd2, buffer, undefined, 100);
        })(),
      ]);
      if (buffer.toString()[0] === 'A') {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataA.length },
          { status: 'fulfilled', value: dataB.length },
        ]);
        expect(buffer.toString()).toContain('A');
        expect(buffer.toString()).not.toContain('B');
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB.length },
          { status: 'fulfilled', value: dataB.length },
        ]);
        expect(buffer.toString()).not.toContain('A');
        expect(buffer.toString()).toContain('B');
      }

      // Cleaning up
      await efs.close(fd1);
      await efs.close(fd2);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);
      fd1 = await efs.open(path1, 'r+');
      fd2 = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.write(fd1, dataB);
        })(),
        (async () => {
          return await efs.read(fd2, buffer, undefined, 100);
        })(),
      ]);
      if (buffer.toString()[0] === 'A') {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB.length },
          { status: 'fulfilled', value: dataA.length },
        ]);
        expect(buffer.toString()).toContain('A');
        expect(buffer.toString()).not.toContain('B');
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB.length },
          { status: 'fulfilled', value: dataB.length },
        ]);
        expect(buffer.toString()).not.toContain('A');
        expect(buffer.toString()).toContain('B');
      }
    });
    test('EncryptedFS.read and EncryptedFS.write with same fd', async () => {
      const path1 = path.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB';
      const buffer = Buffer.alloc(100);
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);
      let fd = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          // Await sleep(100);
          return await efs.write(fd, dataB);
        })(),
        (async () => {
          return await efs.read(fd, buffer, undefined, 100);
        })(),
      ]);
      let stat = await efs.stat(path1);
      if (stat.size === 5) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB.length },
          { status: 'fulfilled', value: 0 },
        ]);
        expect(buffer.toString()).not.toContain('A');
        expect(buffer.toString()).not.toContain('B');
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB.length },
          { status: 'fulfilled', value: dataB.length },
        ]);
        expect(buffer.toString()).toContain('A');
        expect(buffer.toString()).not.toContain('B');
      }

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, dataA);
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.write(fd, dataB);
        })(),
        (async () => {
          return await efs.read(fd, buffer, undefined, 100);
        })(),
      ]);
      stat = await efs.stat(path1);
      if (stat.size === 5) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB.length },
          { status: 'fulfilled', value: 0 },
        ]);
        expect(buffer.toString()).not.toContain('A');
        expect(buffer.toString()).not.toContain('B');
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: dataB.length },
          { status: 'fulfilled', value: dataB.length },
        ]);
        expect(buffer.toString()).toContain('A');
        expect(buffer.toString()).not.toContain('B');
      }
    });
  });
  describe('concurrent directory manipulation', () => {
    test('EncryptedFS.mkdir', async () => {
      const results = await Promise.allSettled([
        efs.mkdir('dir'),
        efs.mkdir('dir'),
      ]);
      expect(
        results.some((result) => {
          return result.status === 'fulfilled';
        }),
      ).toBe(true);
      expect(
        results.some((result) => {
          const status = result.status === 'rejected';
          if (status) {
            expect(result.reason).toBeInstanceOf(ErrorEncryptedFSError);
            expect(result.reason).toHaveProperty('code', errno.EEXIST.code);
            expect(result.reason).toHaveProperty('errno', errno.EEXIST.errno);
            expect(result.reason).toHaveProperty(
              'description',
              errno.EEXIST.description,
            );
          }
          return status;
        }),
      ).toBe(true);
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
      expect(
        results.every((result: PromiseRejectedResult) => {
          const status = result.status === 'rejected';
          if (status) {
            expect(result.reason).toBeInstanceOf(ErrorEncryptedFSError);
            expect(result.reason).toHaveProperty('code', errno.ENOENT.code);
            expect(result.reason).toHaveProperty('errno', errno.ENOENT.errno);
            expect(result.reason).toHaveProperty(
              'description',
              errno.ENOENT.description,
            );
          }
          return status;
        }),
      ).toBe(true);
      expect(await efs.readdir('.')).toContain('one');
    });
    test('EncryptedFS.readdir and EncryptedFS.rmdir', async () => {
      await efs.mkdir('dir');
      // It is possible for only one to succeed or both can succeed
      let results = await Promise.allSettled([
        (async () => {
          // Await sleep(10);
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.rmdir('dir');
        })(),
      ]);
      if (results.every((result) => result.status === 'fulfilled')) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: [] },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        // Has to be readdir that fails if rmdir quickly
        const result = results[0] as PromiseRejectedResult;
        expect(result.status).toBe('rejected');
        expect(result.reason).toBeInstanceOf(ErrorEncryptedFSError);
        expect(result.reason).toHaveProperty('code', errno.ENOENT.code);
        expect(result.reason).toHaveProperty('errno', errno.ENOENT.errno);
        expect(result.reason).toHaveProperty(
          'description',
          errno.ENOENT.description,
        );
      }
      results = await Promise.allSettled([
        (async () => {
          await sleep(0);
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.rmdir('dir');
        })(),
      ]);
      if (results.every((result) => result.status === 'fulfilled')) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: [] },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        // Has to be readdir that fails if rmdir quickly
        const result = results[0] as PromiseRejectedResult;
        expect(result.status).toBe('rejected');
        expect(result.reason).toBeInstanceOf(ErrorEncryptedFSError);
        expect(result.reason).toHaveProperty('code', errno.ENOENT.code);
        expect(result.reason).toHaveProperty('errno', errno.ENOENT.errno);
        expect(result.reason).toHaveProperty(
          'description',
          errno.ENOENT.description,
        );
      }
    });
    test('EncryptedFS.readdir and EncryptedFS.mkdir', async () => {
      await efs.mkdir('dir');
      const path1 = path.join('dir', 'file1');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.mkdir(path1);
        })(),
      ]);
      if (
        results.every((result) => {
          if (
            result.status === 'fulfilled' &&
            typeof result.value === 'object' &&
            result.value.length === 0
          ) {
            return true;
          }
          return result.status === 'fulfilled' && result.value === undefined;
        })
      ) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: [] },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file1'] },
          { status: 'fulfilled', value: undefined },
        ]);
      }
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');

      results = await Promise.allSettled([
        (async () => {
          await sleep(0);
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.mkdir(path1);
        })(),
      ]);
      if (
        results.every((result) => {
          return (
            result.status === 'fulfilled' &&
            (result.value === [] || result.value === undefined)
          );
        })
      ) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: [] },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file1'] },
          { status: 'fulfilled', value: undefined },
        ]);
      }
    });
    test('EncryptedFS.readdir and EncryptedFS.writeFile', async () => {
      await efs.mkdir('dir');
      const path1 = path.join('dir', 'file1');
      let results = await Promise.allSettled([
        (async () => {
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      if (
        results.every((result) => {
          if (
            result.status === 'fulfilled' &&
            typeof result.value === 'object' &&
            result.value.length === 0
          ) {
            return true;
          }
          return result.status === 'fulfilled' && result.value === undefined;
        })
      ) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: [] },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file1'] },
          { status: 'fulfilled', value: undefined },
        ]);
      }
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');

      results = await Promise.allSettled([
        (async () => {
          await sleep(0);
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.writeFile(path1, 'test');
        })(),
      ]);
      if (
        results.every((result) => {
          if (
            result.status === 'fulfilled' &&
            typeof result.value === 'object' &&
            result.value.length === 0
          ) {
            return true;
          }
          return result.status === 'fulfilled' && result.value === undefined;
        })
      ) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: [] },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file1'] },
          { status: 'fulfilled', value: undefined },
        ]);
      }
    });
    test('EncryptedFS.readdir and EncryptedFS.rename', async () => {
      const PATH1 = path.join('dir', 'file1');
      const PATH2 = path.join('dir', 'file2');
      await efs.mkdir('dir');
      await efs.writeFile(PATH1, 'test');

      // With files
      let results = await Promise.allSettled([
        (async () => {
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.rename(PATH1, PATH2);
        })(),
      ]);
      if (
        results.every((result) => {
          if (
            result.status === 'fulfilled' &&
            typeof result.value === 'object' &&
            result.value.includes('file1')
          ) {
            return true;
          }
          return result.status === 'fulfilled' && result.value === undefined;
        })
      ) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file1'] },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file2'] },
          { status: 'fulfilled', value: undefined },
        ]);
      }
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(PATH1, 'test');

      results = await Promise.allSettled([
        (async () => {
          await sleep(10);
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.rename(PATH1, PATH2);
        })(),
      ]);
      if (
        results.every((result) => {
          if (
            result.status === 'fulfilled' &&
            typeof result.value === 'object' &&
            result.value.includes('file1')
          ) {
            return true;
          }
          return result.status === 'fulfilled' && result.value === undefined;
        })
      ) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file1'] },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file2'] },
          { status: 'fulfilled', value: undefined },
        ]);
      }

      // With directories
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.mkdir(PATH1);
      results = await Promise.allSettled([
        (async () => {
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.rename(PATH1, PATH2);
        })(),
      ]);
      if (
        results.every((result) => {
          if (
            result.status === 'fulfilled' &&
            typeof result.value === 'object' &&
            result.value.includes('file1')
          ) {
            return true;
          }
          return result.status === 'fulfilled' && result.value === undefined;
        })
      ) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file1'] },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file2'] },
          { status: 'fulfilled', value: undefined },
        ]);
      }
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.mkdir(PATH1);

      results = await Promise.allSettled([
        (async () => {
          await sleep(10);
          return await efs.readdir('dir');
        })(),
        (async () => {
          return await efs.rename(PATH1, PATH2);
        })(),
      ]);
      if (
        results.every((result) => {
          if (
            result.status === 'fulfilled' &&
            typeof result.value === 'object' &&
            result.value.includes('file1')
          ) {
            return true;
          }
          return result.status === 'fulfilled' && result.value === undefined;
        })
      ) {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file1'] },
          { status: 'fulfilled', value: undefined },
        ]);
      } else {
        expect(results).toStrictEqual([
          { status: 'fulfilled', value: ['file2'] },
          { status: 'fulfilled', value: undefined },
        ]);
      }
    });
    test('EncryptedFS.rmdir and EncryptedFS.rename', async () => {
      const PATH1 = path.join('dir', 'p1');
      const PATH2 = path.join('dir', 'p2');
      await efs.mkdir('dir');
      await efs.mkdir(PATH1);

      // Directories
      let results = await Promise.allSettled([
        (async () => {
          return await efs.rmdir(PATH1);
        })(),
        (async () => {
          return await efs.rename(PATH1, PATH2);
        })(),
      ]);
      if (
        results[0].status === 'fulfilled' &&
        results[1].status === 'rejected'
      ) {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.ENOENT);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.ENOENT);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.mkdir(PATH1);

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.rmdir(PATH1);
        })(),
        (async () => {
          return await efs.rename(PATH1, PATH2);
        })(),
      ]);
      if (
        results[0].status === 'fulfilled' &&
        results[1].status === 'rejected'
      ) {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.ENOENT);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.ENOENT);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }
    });
  });
  describe('concurrent symlinking', () => {
    test('EncryptedFS.symlink and EncryptedFS.symlink', async () => {
      const path1 = path.join('dir', 'file1');
      const path2 = path.join('dir', 'file2');
      await efs.mkdir('dir');
      await efs.writeFile(path1, 'test');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.symlink(path1, path2);
        })(),
        (async () => {
          return await efs.symlink(path1, path2);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, 'test');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.symlink(path1, path2);
        })(),
        (async () => {
          return await efs.symlink(path1, path2);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }
    });
    test('EncryptedFS.symlink and EncryptedFS.mknod', async () => {
      const path1 = path.join('dir', 'file1');
      const path2 = path.join('dir', 'file2');
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.symlink(path1, path2);
        })(),
        (async () => {
          return await efs.mknod(path2, constants.S_IFREG, 0, 0);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.symlink(path1, path2);
        })(),
        (async () => {
          return await efs.mknod(path2, constants.S_IFREG, 0, 0);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }
    });
    test('EncryptedFS.mkdir and EncryptedFS.symlink', async () => {
      const path1 = path.join('dir', 'file1');
      const path2 = path.join('dir', 'file2');
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.symlink(path1, path2);
        })(),
        (async () => {
          return await efs.mkdir(path2);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.symlink(path1, path2);
        })(),
        (async () => {
          return await efs.mkdir(path2);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }
    });
    test('EncryptedFS.write and EncryptedFS.symlink', async () => {
      const path1 = path.join('dir', 'file1');
      const path2 = path.join('dir', 'file2');
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      let fd = await efs.open(path1, 'r+');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.write(fd, 'test');
        })(),
        (async () => {
          return await efs.symlink(path1, path2);
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: 4 },
        { status: 'fulfilled', value: undefined },
      ]);

      // Cleaning up
      await efs.close(fd);
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      fd = await efs.open(path1, 'r+');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.write(fd, 'test');
        })(),
        (async () => {
          return await efs.symlink(path1, path2);
        })(),
      ]);
      expect(results).toStrictEqual([
        { status: 'fulfilled', value: 4 },
        { status: 'fulfilled', value: undefined },
      ]);
    });
  });
  describe('concurrent inode linking and unlinking', () => {
    test('EncryptedFS.link and EncryptedFS.link', async () => {
      const path1 = path.join('dir', 'file1');
      const path2 = path.join('dir', 'file2');
      await efs.mkdir('dir');
      await efs.writeFile(path1, 'test');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.link(path1, path2);
        })(),
        (async () => {
          return await efs.link(path1, path2);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, 'test');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.link(path1, path2);
        })(),
        (async () => {
          return await efs.link(path1, path2);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }
    });
    test('EncryptedFS.link and EncryptedFS.symlink', async () => {
      const path1 = path.join('dir', 'file1');
      const path2 = path.join('dir', 'file2');
      await efs.mkdir('dir');
      await efs.writeFile(path1, 'test');

      let results = await Promise.allSettled([
        (async () => {
          return await efs.link(path1, path2);
        })(),
        (async () => {
          return await efs.symlink(path1, path2);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }

      // Cleaning up
      await efs.rmdir('dir', { recursive: true });
      await efs.mkdir('dir');
      await efs.writeFile(path1, 'test');

      results = await Promise.allSettled([
        (async () => {
          await sleep(100);
          return await efs.link(path1, path2);
        })(),
        (async () => {
          return await efs.symlink(path1, path2);
        })(),
      ]);
      if (results[0].status === 'fulfilled') {
        expect(results[0]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
        expectReason(results[1], ErrorEncryptedFSError, errno.EEXIST);
      } else {
        expectReason(results[0], ErrorEncryptedFSError, errno.EEXIST);
        expect(results[1]).toStrictEqual({
          status: 'fulfilled',
          value: undefined,
        });
      }
    });
  });
});
