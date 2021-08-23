import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import * as utils from '@/utils';

describe('INodeManager File', () => {
  const logger = new Logger('INodeManager File Test', LogLevel.WARN, [new StreamHandler()]);
  const devMgr = new vfs.DeviceManager();
  let dataDir: string;
  let db: DB;
  let dbKey: Buffer = utils.generateKeySync(256);
  let blockSize = 5;
  const buffer = Buffer.from('Test Buffer');
  const compareBuffer = Buffer.alloc(blockSize);
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    db = await DB.createDB({
      dbKey,
      dbPath: `${dataDir}/db`,
      logger
    });
    await db.start();
  });
  afterEach(async () => {
    await db.stop();
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test('create a file', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    await db.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(fileIno);
      });
      await iNodeMgr.fileCreate(
        tran,
        fileIno,
        {
          mode: vfs.DEFAULT_FILE_PERM,
          uid: vfs.DEFAULT_ROOT_UID,
          gid: vfs.DEFAULT_ROOT_GID,
        }
      );
      const stat = await iNodeMgr.statGet(tran, fileIno);
      expect(stat['ino']).toBe(fileIno);
      expect(stat.isDirectory()).toBe(false);
      expect(stat['uid']).toBe(vfs.DEFAULT_ROOT_UID);
      expect(stat['gid']).toBe(vfs.DEFAULT_ROOT_GID);
      // the mode should start at the default file permissions
      // expect(stat['mode']).toBe(vfs.DEFAULT_FILE_PERM);
      // all timestamps should be the same at creation
      expect(stat['atime']).toEqual(stat['mtime']);
      expect(stat['mtime']).toEqual(stat['ctime']);
      expect(stat['birthtime']).toEqual(stat['birthtime']);
    });
  });
  test('create a file with supplied data', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    await db.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(fileIno);
      });
      await iNodeMgr.fileCreate(
        tran,
        fileIno,
        {
          mode: vfs.DEFAULT_FILE_PERM,
          uid: vfs.DEFAULT_ROOT_UID,
          gid: vfs.DEFAULT_ROOT_GID,
        },
        buffer,
      );
      const stat = await iNodeMgr.statGet(tran, fileIno);
      expect(stat['ino']).toBe(fileIno);
      expect(stat.isDirectory()).toBe(false);
      expect(stat['uid']).toBe(vfs.DEFAULT_ROOT_UID);
      expect(stat['gid']).toBe(vfs.DEFAULT_ROOT_GID);
      // all timestamps should be the same at creation
      expect(stat['atime']).toEqual(stat['mtime']);
      expect(stat['mtime']).toEqual(stat['ctime']);
      expect(stat['birthtime']).toEqual(stat['birthtime']);

      let counter = 0;
      for await (const block of iNodeMgr.fileGetBlocks(tran, fileIno)) {
        buffer.copy(compareBuffer, 0, counter, counter + blockSize);
        expect(block).toStrictEqual(compareBuffer);
        counter += blockSize;
      }
    });
  });
  test('write data to a file', async () => {
    let blockSize = 2;
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    await db.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(fileIno);
      });
      await iNodeMgr.fileCreate(
        tran,
        fileIno,
        {
          mode: vfs.DEFAULT_FILE_PERM,
          uid: vfs.DEFAULT_ROOT_UID,
          gid: vfs.DEFAULT_ROOT_GID,
        },
      );
      await iNodeMgr.fileSetData(tran, fileIno, buffer, blockSize);
      let counter = 0;
      for await (const block of iNodeMgr.fileGetBlocks(tran, fileIno)) {
        buffer.copy(compareBuffer, 0, counter, counter + blockSize);
        expect(block).toStrictEqual(compareBuffer);
        counter += blockSize;
      }
    });
  });
  test('read data from a file', async () => {
    let blockSize = 2;
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    await db.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(fileIno);
      });
      await iNodeMgr.fileCreate(
        tran,
        fileIno,
        {
          mode: vfs.DEFAULT_FILE_PERM,
          uid: vfs.DEFAULT_ROOT_UID,
          gid: vfs.DEFAULT_ROOT_GID,
        },
      );
      await iNodeMgr.fileSetData(tran, fileIno, buffer, blockSize);
      for await (const block of iNodeMgr.fileGetBlocks(tran, fileIno, 1, 1)) {
        expect(block).toStrictEqual(Buffer.from('Te'));
      }
    });
  });
});
