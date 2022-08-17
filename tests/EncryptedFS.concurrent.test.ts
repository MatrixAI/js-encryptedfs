import type { FdIndex } from '@/fd/types';
import type { INodeData } from '@/inodes/types';
import fs from 'fs';
import os from 'os';
import pathNode from 'path';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { code as errno } from 'errno';
import { DB } from '@matrixai/db';
import * as fc from 'fast-check';
import EncryptedFS from '@/EncryptedFS';
import { ErrorEncryptedFSError } from '@/errors';
import * as utils from '@/utils';
import * as constants from '@/constants';
import INodeManager from '@/inodes/INodeManager';
import { promise } from '@/utils';
import { expectError, expectReason, sleep } from './utils';

describe(`${EncryptedFS.name} Concurrency`, () => {
  const logger = new Logger(`${EncryptedFS.name} Concurrency`, LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const dbKey: Buffer = utils.generateKeySync(256);
  const interruptAfterTimeLimit = globalThis.defaultTimeout - 2000;
  let dataDir: string;
  let db: DB;
  let iNodeMgr: INodeManager;
  let efs: EncryptedFS;

  const scheduleCall = <T>(
    s: fc.Scheduler,
    f: () => Promise<T>,
    label: string = 'scheduled call',
  ) => s.schedule(Promise.resolve(label)).then(() => f());

  const totalINodes = async (iNodeMgr: INodeManager) => {
    let counter = 0;
    for await (const _ of iNodeMgr.getAll()) {
      counter += 1;
    }
    return counter;
  };

  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      pathNode.join(os.tmpdir(), 'encryptedfs-test-'),
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
    test('EncryptedFS.open, EncryptedFS.mknod and EncryptedFS.mkdir', async () => {
      const path1 = pathNode.join('dir', 'file1');

      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            const prom = Promise.allSettled([
              scheduleCall(
                s,
                () => efs.mknod(path1, constants.S_IFREG, 0, 0),
                'mknod 1',
              ),
              scheduleCall(
                s,
                () => efs.mknod(path1, constants.S_IFREG, 0, 0),
                'mknod 2',
              ),
              scheduleCall(
                s,
                () => efs.open(path1, constants.O_RDWR | constants.O_CREAT),
                'open 1',
              ),
              scheduleCall(
                s,
                () => efs.open(path1, constants.O_RDWR | constants.O_CREAT),
                'open 2',
              ),
              scheduleCall(s, () => efs.mkdir(path1), 'mkdir 1'),
              scheduleCall(s, () => efs.mkdir(path1), 'mkdir 2'),
            ]);
            await s.waitAll();
            const results = await prom;
            results.map((item) => {
              if (item.status !== 'fulfilled') {
                // Should fail as a normal FS error
                expectReason(item, ErrorEncryptedFSError);
              }
            });
            // Should have at least 1 success
            expect(results.some((item) => item.status === 'fulfilled')).toBe(
              true,
            );
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'dir1');
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
      // Concurrent writes of different length results in "last write wins" or a merge
      const contents = ['one', 'two', 'one1', 'two2'];
      await fc.assert(
        fc.asyncProperty(fc.scheduler(), async (s) => {
          const fds: Array<FdIndex> = [
            await efs.open('test', constants.O_RDWR | constants.O_CREAT),
            await efs.open('test', constants.O_RDWR | constants.O_CREAT),
            await efs.open('test', constants.O_RDWR | constants.O_CREAT),
            await efs.open('test', constants.O_RDWR | constants.O_CREAT),
          ];

          // Concurrent writes of the same length results in "last write wins"
          const prom = Promise.all([
            scheduleCall(s, () => efs.write(fds[0], contents[0]), 'write 1'),
            scheduleCall(s, () => efs.write(fds[1], contents[1]), 'write 2'),
            scheduleCall(s, () => efs.write(fds[2], contents[2]), 'write 3'),
            scheduleCall(s, () => efs.write(fds[3], contents[3]), 'write 4'),
          ]);
          await s.waitAll();
          await prom;

          expect(['one', 'two', 'one1', 'one2', 'two2', 'two1']).toContainEqual(
            await efs.readFile('test', { encoding: 'utf-8' }),
          );
          for (const fd of fds) {
            await efs.close(fd);
          }
        }),
        { numRuns: 50, interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.write on the same file descriptor', async () => {
      await fc.assert(
        fc.asyncProperty(fc.scheduler(), async (s) => {
          await efs.writeFile('test', '');
          const fd = await efs.open('test', 'w');

          const prom = Promise.all([
            scheduleCall(s, () => efs.write(fd, 'aaa'), 'write 1'),
            scheduleCall(s, () => efs.write(fd, 'bbb'), 'write 2'),
          ]);
          await s.waitAll();
          await prom;

          expect(['aaabbb', 'bbbaaa']).toContainEqual(
            await efs.readFile('test', { encoding: 'utf-8' }),
          );
          await efs.close(fd);
        }),
        { numRuns: 20, interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.writeFile', async () => {
      await fc.assert(
        fc.asyncProperty(fc.scheduler(), async (s) => {
          // Concurrent writes of different length results in "last write wins" or a merge
          await efs.writeFile('test', '');

          const prom = Promise.all([
            scheduleCall(s, () => efs.writeFile('test', 'one'), 'writeFile 1'),
            scheduleCall(s, () => efs.writeFile('test', 'one1'), 'writeFile 2'),
            scheduleCall(s, () => efs.writeFile('test', 'two'), 'writeFile 2'),
            scheduleCall(s, () => efs.writeFile('test', 'two2'), 'writeFile 2'),
          ]);
          await s.waitAll();
          await prom;

          expect(['one', 'two', 'one1', 'one2', 'two2', 'two1']).toContainEqual(
            await efs.readFile('test', { encoding: 'utf-8' }),
          );
          expect(await totalINodes(iNodeMgr)).toEqual(2);
        }),
        { numRuns: 50, interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.appendFile', async () => {
      await fc.assert(
        fc.asyncProperty(fc.scheduler(), async (s) => {
          // Concurrent appends results in mutually exclusive writes
          await efs.writeFile('test', 'original');

          const prom = Promise.all([
            scheduleCall(
              s,
              () => efs.appendFile('test', 'one'),
              'appendFile 1',
            ),
            scheduleCall(
              s,
              () => efs.appendFile('test', 'two'),
              'appendFile 2',
            ),
          ]);
          await s.waitAll();
          await prom;

          // Either order of appending is acceptable
          expect(['originalonetwo', 'originaltwoone']).toContainEqual(
            await efs.readFile('test', { encoding: 'utf-8' }),
          );
        }),
        { numRuns: 20, interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.fallocate, EncryptedFS.writeFile, EncryptedFS.write and EncryptedFS.createWriteStream ', async () => {
      const path1 = pathNode.join('dir', 'file1');
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            const fd = await efs.open(path1, 'wx+');

            const prom = Promise.all([
              scheduleCall(s, () => efs.fallocate(fd, 0, 100), 'fallocate'),
              scheduleCall(s, () => efs.writeFile(path1, 'test'), 'writeFile'),
              scheduleCall(s, () => efs.write(fd, 'test'), 'write'),
              scheduleCall(
                s,
                async () => {
                  const writeStream = efs.createWriteStream(path1);
                  for (let i = 0; i < 10; i++) {
                    writeStream.write(i.toString());
                  }
                  writeStream.end();
                  const endProm = promise<void>();
                  writeStream.on('finish', () => endProm.resolveP());
                  await endProm.p;
                },
                'writeStream',
              ),
            ]);
            await s.waitAll();
            await prom;
            expect((await efs.stat(path1)).size).toBe(100);
            const contents = await efs.readFile(path1);
            expect(contents.length).toBeGreaterThanOrEqual(4);
            expect(contents.length).toBeLessThanOrEqual(100);

            await efs.close(fd);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.fallocate and EncryptedFS.writeFile', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
    test('EncryptedFS.truncate and EncryptedFS.writeFile, EncryptedFS.write and EncryptedFS.createWriteStream', async () => {
      const path1 = pathNode.join('dir', 'file1');
      const phrase = 'The quick brown fox jumped over the lazy dog';
      const phraseSplit = phrase.split(' ');
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            const fd = await efs.open(path1, 'wx+');

            const prom = Promise.all([
              scheduleCall(s, () => efs.truncate(path1, 27), 'truncate'),
              scheduleCall(s, () => efs.writeFile(path1, phrase), 'writeFile'),
              scheduleCall(s, () => efs.write(fd, phrase), 'write'),
              scheduleCall(
                s,
                async () => {
                  const writeStream = efs.createWriteStream(path1);
                  for (const i of phraseSplit) {
                    writeStream.write(i + ' ');
                  }
                  writeStream.end();
                  const endProm = promise<void>();
                  writeStream.on('finish', () => endProm.resolveP());
                  await endProm.p;
                },
                'writeStream',
              ),
            ]);
            await s.waitAll();
            await prom;
            const contents = await efs.readFile(path1);
            expect(contents.length).toBeGreaterThanOrEqual(27);
            expect(contents.length).toBeLessThanOrEqual(45);

            await efs.close(fd);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.truncate and EncryptedFS.writeFile', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
    test('EncryptedFS.ftruncate and EncryptedFS.writeFile, EncryptedFS.write and EncryptedFS.createWriteStream', async () => {
      const path1 = pathNode.join('dir', 'file1');
      const phrase = 'The quick brown fox jumped over the lazy dog';
      const phraseSplit = phrase.split(' ');
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            const fd = await efs.open(path1, 'wx+');

            const prom = Promise.all([
              scheduleCall(s, () => efs.ftruncate(fd, 27), 'ftruncate'),
              scheduleCall(s, () => efs.writeFile(path1, phrase), 'writeFile'),
              scheduleCall(s, () => efs.write(fd, phrase), 'write'),
              scheduleCall(
                s,
                async () => {
                  const writeStream = efs.createWriteStream(path1);
                  for (const i of phraseSplit) {
                    writeStream.write(i + ' ');
                  }
                  writeStream.end();
                  const endProm = promise<void>();
                  writeStream.on('finish', () => endProm.resolveP());
                  await endProm.p;
                },
                'writeStream',
              ),
            ]);
            await s.waitAll();
            await prom;
            const contents = await efs.readFile(path1);
            expect(contents.length).toBeGreaterThanOrEqual(27);
            expect(contents.length).toBeLessThanOrEqual(45);

            await efs.close(fd);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.ftruncate and EncryptedFS.writeFile', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
    test('EncryptedFS.utimes, EncryptedFS.futimes and EncryptedFS.writeFile', async () => {
      const path1 = pathNode.join('dir', 'file1');
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            const fd = await efs.open(path1, 'wx+');
            await efs.writeFile(fd, 'test');

            const prom = Promise.all([
              scheduleCall(s, () => efs.utimes(path1, 0, 0), 'utimes file'),
              scheduleCall(s, () => efs.utimes('dir', 0, 0), 'utimes dir'),
              scheduleCall(s, () => efs.futimes(fd, 0, 0), 'futimes'),
              scheduleCall(s, () => efs.writeFile(path1, 'test'), 'writeFile'),
            ]);
            await s.waitAll();
            await prom;

            await efs.close(fd);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.utimes and EncryptedFS.writeFile', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'dir1');
      const path2 = utils.pathJoin(path1, 'file1');
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
    test('EncryptedFS.lseek, EncryptedFS.writeFile, EncryptedFS.writeFile with fd, EncryptedFS.write, EncryptedFS.readFile, EncryptedFS.read, and seeking position', async () => {
      const path1 = pathNode.join('dir', 'file1');
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            const fd = await efs.open(path1, 'wx+');
            await efs.writeFile(
              path1,
              'The quick brown fox jumped over the lazy dog',
            );

            const buffer = Buffer.alloc(45);
            const prom = Promise.all([
              scheduleCall(
                s,
                () => efs.lseek(fd, 20, constants.SEEK_CUR),
                'seek move',
              ),
              scheduleCall(
                s,
                () => efs.writeFile(path1, 'test'),
                'writeFile path',
              ),
              scheduleCall(s, () => efs.writeFile(fd, 'test'), 'writeFile fd'),
              scheduleCall(s, () => efs.write(fd, 'test'), 'write'),
              scheduleCall(s, () => efs.readFile(path1), 'readFile'),
              scheduleCall(
                s,
                () => efs.read(fd, buffer, undefined, 44),
                'read',
              ),
              scheduleCall(
                s,
                () => efs.lseek(fd, 15, constants.SEEK_SET),
                'seek set',
              ),
            ]);
            await s.waitAll();
            await prom;
            const stat = await efs.stat(path1);
            expect(stat.size).toBeGreaterThanOrEqual(4);
            expect(stat.size).toBeLessThanOrEqual(80);
            const contents = await efs.readFile(path1);
            expect(contents.length).toBeGreaterThanOrEqual(4);
            expect(contents.length).toBeLessThanOrEqual(80);

            await efs.close(fd);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.lseek and EncryptedFS.writeFile', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
    test('EncryptedFS.createReadStream, EncryptedFS.createWriteStream, EncryptedFS.write, EncryptedFS.read', async () => {
      const path1 = pathNode.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB'.repeat(5);
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            const fd = await efs.open(path1, 'wx+');
            await efs.writeFile(path1, dataB);

            const buffer = Buffer.alloc(110);
            const prom = Promise.all([
              scheduleCall(
                s,
                async () => {
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
                },
                'readStream 1',
              ),
              scheduleCall(
                s,
                async () => {
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
                },
                'readStream 2',
              ),
              scheduleCall(
                s,
                async () => {
                  const writeStream = efs.createWriteStream(path1);
                  for (let i = 0; i < 10; i++) {
                    writeStream.write(dataA);
                  }
                  writeStream.end();
                  const endProm = promise<void>();
                  writeStream.on('finish', () => endProm.resolveP());
                  await endProm.p;
                },
                'writeStream 1',
              ),
              scheduleCall(
                s,
                async () => {
                  const writeStream = efs.createWriteStream(path1);
                  for (let i = 0; i < 10; i++) {
                    writeStream.write(dataA);
                  }
                  writeStream.end();
                  const endProm = promise<void>();
                  writeStream.on('finish', () => endProm.resolveP());
                  await endProm.p;
                },
                'writeStream 2',
              ),
              scheduleCall(s, () => efs.write(fd, dataB), 'write'),
              scheduleCall(
                s,
                () => efs.read(fd, buffer, undefined, 100),
                'read',
              ),
            ]);
            await s.waitAll();
            await prom;
            const stat = await efs.stat(path1);
            expect(stat.size).toEqual(50);
            const contents = await efs.readFile(path1);
            expect(contents.length).toEqual(50);

            await efs.close(fd);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.createReadStream and EncryptedFS.createWriteStream', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
            await sleep(50);
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
      contents = (await efs.readFile(path1, { encoding: 'utf-8' })) as string;
      expect(stat.size).toEqual(50);
      expect(contents).toHaveLength(50);
      expect(contents).toMatch(/^(BBBBB){0,5}A+$/);
    });
    test('EncryptedFS.createReadStream and EncryptedFS.write', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
      const dataA = 'AAAAA';
      await efs.mkdir('dir');
      await efs.writeFile(path1, '');
      const fd = await efs.open(path1, 'r+');
      const buffer = Buffer.alloc(100);
      const results = await Promise.allSettled([
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
      const contents = buffer.toString();
      // Each write is atomic, so reads will occur at multiples of each write
      expect(results).toStrictEqual([
        {
          status: 'fulfilled',
          value: expect.toSatisfy((v) => v % 5 === 0),
        },
        {
          status: 'fulfilled',
          value: undefined,
        },
      ]);
      const bytesRead = (results[0] as PromiseFulfilledResult<number>).value;
      expect(contents).toStrictEqual(
        dataA.repeat(bytesRead / 5) + '\0'.repeat(100 - bytesRead),
      );
    });
    test('EncryptedFS.createReadStream and EncryptedFS.read', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
    test('EncryptedFS.unlink, EncryptedFS.writeFile, EncryptedFS.open, EncryptedFS.write and EncryptedFS.createWriteStream', async () => {
      const path1 = pathNode.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB'.repeat(5);
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            const fd = await efs.open(path1, 'wx+');
            await efs.writeFile(path1, dataB);

            const prom = Promise.all([
              scheduleCall(s, () => efs.unlink(path1), 'unlink'),
              scheduleCall(s, () => efs.writeFile(path1, 'test'), 'writeFile'),
              scheduleCall(
                s,
                async () => {
                  let fd: FdIndex;
                  try {
                    fd = await efs.open(path1, 'r+');
                    await efs.close(fd!);
                  } catch (e) {
                    // Ignore FS errors
                    if (!(e instanceof ErrorEncryptedFSError)) throw e;
                  }
                },
                'open',
              ),
              scheduleCall(s, () => efs.write(fd, 'test'), 'write'),
              scheduleCall(
                s,
                async () => {
                  const writeStream = efs.createWriteStream(path1);
                  for (let i = 0; i < 10; i++) {
                    writeStream.write(dataA);
                  }
                  writeStream.end();
                  const endProm = promise<void>();
                  writeStream.on('finish', () => endProm.resolveP());
                  await endProm.p;
                },
                'writeStream',
              ),
            ]);
            await s.waitAll();
            // Expecting no transaction errors
            await prom;

            await efs.close(fd);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.unlink and EncryptedFS.writeFile', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
    test('EncryptedFS.appendFIle, EncryptedFS.writeFile, EncryptedFS.writeFile with fd, EncryptedFS.write, EncryptedFS.createReadStream', async () => {
      const path1 = pathNode.join('dir', 'file1');
      const dataA = 'A'.repeat(10);
      const dataB = 'B'.repeat(10);
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            const fd = await efs.open(path1, 'wx+');
            await efs.writeFile(path1, '');

            const prom = Promise.all([
              scheduleCall(
                s,
                () => efs.appendFile(path1, dataA),
                'appendFile path',
              ),
              scheduleCall(s, () => efs.appendFile(fd, dataA), 'appendFile fd'),
              scheduleCall(
                s,
                () => efs.writeFile(path1, dataB),
                'writeFile path',
              ),
              scheduleCall(s, () => efs.writeFile(fd, dataB), 'writeFile fd'),
              scheduleCall(s, () => efs.write(fd, dataB), 'write'),
              scheduleCall(
                s,
                async () => {
                  const writeStream = efs.createWriteStream(path1);
                  for (let i = 0; i < 10; i++) {
                    writeStream.write(dataA);
                  }
                  writeStream.end();
                  const endProm = promise<void>();
                  writeStream.on('finish', () => endProm.resolveP());
                  await endProm.p;
                },
                'readStream',
              ),
            ]);
            await s.waitAll();
            // Expecting no transaction errors
            await prom;
            const stat = await efs.stat(path1);
            expect(stat.size).toEqual(100);
            const contents = await efs.readFile(path1);
            expect(contents.length).toEqual(100);

            await efs.close(fd);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.appendFIle and EncryptedFS.writeFile', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
    test('EncryptedFS.copyFile, EncryptedFS.writeFile, EncryptedFS.writeFile with fd, EncryptedFS.write and EncryptedFS.createWriteStream', async () => {
      const path1 = pathNode.join('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
      const dataA = 'A'.repeat(10);
      const dataB = 'B'.repeat(10);
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            const fd = await efs.open(path1, 'wx+');
            await efs.writeFile(path1, '');
            await efs.writeFile(path1, dataA);

            const prom = Promise.all([
              scheduleCall(s, () => efs.copyFile(path1, path2), 'copyFile'),
              scheduleCall(
                s,
                () => efs.writeFile(path1, dataB),
                'writeFile path',
              ),
              scheduleCall(s, () => efs.writeFile(fd, dataB), 'writeFile fd'),
              scheduleCall(s, () => efs.write(fd, dataB), 'write'),
              scheduleCall(
                s,
                async () => {
                  const writeStream = efs.createWriteStream(path1);
                  for (let i = 0; i < 10; i++) {
                    writeStream.write(dataA);
                  }
                  writeStream.end();
                  const endProm = promise<void>();
                  writeStream.on('finish', () => endProm.resolveP());
                  await endProm.p;
                },
                'writeStream',
              ),
            ]);
            await s.waitAll();
            // Expecting no transaction errors
            await prom;
            const stat = await efs.stat(path1);
            expect(stat.size).toEqual(100);
            const contents = await efs.readFile(path1);
            expect(contents.length).toEqual(100);

            await efs.close(fd);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.copyFile and EncryptedFS.writeFile', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
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
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
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
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
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
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
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
      expect(contents).toMatch(RegExp('^(AAAAA)*$'));
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
      expect(contents).toMatch(RegExp('^(AAAAA)*$'));
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
      const path1 = pathNode.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB';
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            await efs.writeFile(path1, dataA);

            const prom = Promise.allSettled([
              scheduleCall(s, () => efs.writeFile(path1, dataB), 'writeFile'),
              scheduleCall(
                s,
                async () => {
                  return (await efs.readFile(path1)).toString();
                },
                'readFile',
              ),
            ]);
            await s.waitAll();
            // Expecting no transaction errors
            const results = await prom;
            if (
              results[1].status === 'fulfilled' &&
              results[1].value[0] === 'A'
            ) {
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
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { numRuns: 20, interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.read and EncryptedFS.write', async () => {
      const path1 = pathNode.join('dir', 'file1');
      const dataA = 'AAAAA';
      const dataB = 'BBBBB';
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            await efs.writeFile(path1, dataA);
            const fd1 = await efs.open(path1, 'r+');
            const fd2 = await efs.open(path1, 'r+');
            const buffer1 = Buffer.alloc(100);
            const buffer2 = Buffer.alloc(100);

            const prom = Promise.all([
              scheduleCall(s, () => efs.write(fd1, dataB), 'write fd1'),
              scheduleCall(
                s,
                () => efs.read(fd1, buffer1, undefined, 100),
                'read fd1',
              ),
              scheduleCall(
                s,
                () => efs.read(fd2, buffer2, undefined, 100),
                'read fd2',
              ),
            ]);
            await s.waitAll();
            // Expecting no transaction errors
            await prom;

            await efs.close(fd1);
            await efs.close(fd2);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { numRuns: 20, interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.read and EncryptedFS.write with different fd', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
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
      const path1 = utils.pathJoin('dir', 'file1');
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
    test('EncryptedFS.mkdir, recursive and rename', async () => {
      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            const prom = Promise.all([
              scheduleCall(s, () => efs.mkdir('dir'), 'mkdir 1'),
              scheduleCall(s, () => efs.mkdir('dir'), 'mkdir 2'),
              scheduleCall(
                s,
                () => efs.mkdir('dir/dira/dirb', { recursive: true }),
                'mkdir recursive 1',
              ),
              scheduleCall(
                s,
                () => efs.mkdir('dir/dira/dirb', { recursive: true }),
                'mkdir recursive 2',
              ),
              scheduleCall(s, () => efs.rename('dir', 'one'), 'rename 1'),
              scheduleCall(s, () => efs.rename('dir', 'two'), 'rename 2'),
            ]);
            await s.waitAll();
            // Expecting no transaction errors
            try {
              await prom;
            } catch (e) {
              if (!(e instanceof ErrorEncryptedFSError)) throw e;
            }
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
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
    test('EncryptedFS.readdir, EncryptedFS.rmdir, EncryptedFS.mkdir, EncryptedFS.writeFile and EncryptedFS.rename', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');

      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            const prom = Promise.all([
              scheduleCall(s, () => efs.readdir('dir'), 'readdir'),
              scheduleCall(
                s,
                () => efs.rmdir('dir', { recursive: true }),
                'rmdir',
              ),
              scheduleCall(s, () => efs.mkdir(path1), 'mkdir'),
              scheduleCall(s, () => efs.writeFile(path1, 'test'), 'writeFile'),
              scheduleCall(s, () => efs.rename(path1, path2), 'rename'),
            ]);
            await s.waitAll();
            // Expecting no transaction errors
            await expectError(prom, ErrorEncryptedFSError);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
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
      const path1 = utils.pathJoin('dir', 'file1');

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
      const path1 = utils.pathJoin('dir', 'file1');
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
      const PATH1 = utils.pathJoin('dir', 'file1');
      const PATH2 = utils.pathJoin('dir', 'file2');
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
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');

      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            await efs.mkdir(path1);

            const prom = Promise.allSettled([
              scheduleCall(s, () => efs.rmdir(path1), 'rmdir'),
              scheduleCall(s, () => efs.rename(path1, path2), 'rename'),
            ]);
            await s.waitAll();
            // Expecting no transaction errors
            const results = await prom;
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
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { numRuns: 20, interruptAfterTimeLimit },
      );
    });
  });
  describe('concurrent symlinking', () => {
    test('EncryptedFS.symlink, EncryptedFS.symlink and EncryptedFS.mknod', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');

      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            await efs.writeFile(path1, 'test');
            const fd = await efs.open(path1, 'r+');

            const prom = Promise.all([
              scheduleCall(s, () => efs.symlink(path1, path2), 'symlink 1'),
              scheduleCall(s, () => efs.symlink(path1, path2), 'symlink 2'),
              scheduleCall(
                s,
                () => efs.mknod(path2, constants.S_IFREG, 0, 0),
                'mknod',
              ),
              scheduleCall(s, () => efs.mkdir(path2), 'mkdir'),
              scheduleCall(s, () => efs.write(fd, 'test'), 'write'),
            ]);
            await s.waitAll();
            // Expecting no transaction errors
            await expectError(prom, ErrorEncryptedFSError);

            await efs.close(fd);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.symlink and EncryptedFS.symlink', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
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
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
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
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
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
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
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
    test('EncryptedFS.link,  EncryptedFS.link and EncryptedFS.symlink', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');

      await fc.assert(
        fc
          .asyncProperty(fc.scheduler(), async (s) => {
            await efs.mkdir('dir');
            await efs.writeFile(path1, 'test');

            const prom = Promise.all([
              scheduleCall(s, () => efs.link(path1, path2), 'link 1'),
              scheduleCall(s, () => efs.link(path1, path2), 'link 2'),
              scheduleCall(s, () => efs.symlink(path1, path2), 'symlink'),
            ]);
            await s.waitAll();
            // Expecting no transaction errors
            await expectError(prom, ErrorEncryptedFSError);
          })
          .afterEach(async () => {
            // Cleaning up
            await efs.rmdir('dir', { recursive: true });
          }),
        { numRuns: 20, interruptAfterTimeLimit },
      );
    });
    test('EncryptedFS.link and EncryptedFS.link', async () => {
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
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
      const path1 = utils.pathJoin('dir', 'file1');
      const path2 = utils.pathJoin('dir', 'file2');
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
