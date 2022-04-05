import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { DB } from '@matrixai/db';
import INodeManager from '@/inodes/INodeManager';
import * as utils from '@/utils';
import * as constants from '@/constants';
import * as permissions from '@/permissions';

describe('INodeManager File', () => {
  const logger = new Logger('INodeManager File Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
  const blockSize = 5;
  const buffer = Buffer.from('Test Buffer');
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    db = await DB.createDB({
      dbPath: `${dataDir}/db`,
      crypto: {
        key: dbKey,
        ops: {
          encrypt: utils.encrypt,
          decrypt: utils.decrypt,
        },
      },
      logger,
    });
    await db.start();
  });
  afterEach(async () => {
    await db.stop();
    await db.destroy();
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test('create a file', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(fileIno);
      });
      await iNodeMgr.fileCreate(
        fileIno,
        {
          mode: permissions.DEFAULT_FILE_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        },
        blockSize,
        undefined,
        tran,
      );
      const stat = await iNodeMgr.statGet(fileIno, tran);
      expect(stat['ino']).toBe(fileIno);
      expect(stat.isDirectory()).toBe(false);
      expect(stat['uid']).toBe(permissions.DEFAULT_ROOT_UID);
      expect(stat['gid']).toBe(permissions.DEFAULT_ROOT_GID);
      // The size, blocks and block size should be 0 if no data supplied
      expect(stat['size']).toBe(0);
      expect(stat['blksize']).toBe(5); // 5 was supplied
      expect(stat['blocks']).toBe(0);
      // The mode should start at the default file permissions
      expect(stat['mode']).toBe(
        constants.S_IFREG | (permissions.DEFAULT_FILE_PERM & ~constants.S_IFMT),
      );
      // All timestamps should be the same at creation
      expect(stat['atime']).toEqual(stat['mtime']);
      expect(stat['mtime']).toEqual(stat['ctime']);
      expect(stat['birthtime']).toEqual(stat['birthtime']);
    });
  });
  test('create a file with supplied data', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(fileIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(fileIno);
      });
      await iNodeMgr.fileCreate(
        fileIno,
        {
          mode: permissions.DEFAULT_FILE_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        },
        blockSize,
        buffer,
        tran,
      );
      const stat = await iNodeMgr.statGet(fileIno, tran);
      expect(stat['ino']).toBe(fileIno);
      expect(stat.isDirectory()).toBe(false);
      expect(stat['uid']).toBe(permissions.DEFAULT_ROOT_UID);
      expect(stat['gid']).toBe(permissions.DEFAULT_ROOT_GID);
      // The size, blocks and block size should be set if data supplied
      expect(stat['size']).toBe(buffer.length);
      expect(stat['blksize']).toBe(5);
      expect(stat['blocks']).toBe(3);
      // All timestamps should be the same at creation
      expect(stat['atime']).toEqual(stat['mtime']);
      expect(stat['mtime']).toEqual(stat['ctime']);
      expect(stat['birthtime']).toEqual(stat['birthtime']);
    });
    let counter = 0;
    // Alocate a buffer that will accept the blocks of the iNode
    const compareBuffer = Buffer.alloc(buffer.length);
    await iNodeMgr.withTransactionF(fileIno, async (tran) => {
      for await (const block of iNodeMgr.fileGetBlocks(
        fileIno,
        blockSize,
        undefined,
        undefined,
        tran,
      )) {
        // Copy the blocks into the compare buffer
        block.copy(compareBuffer, counter);
        counter += blockSize;
      }
    });
    expect(compareBuffer).toStrictEqual(buffer);
    let idx, block;
    // Check that we can also correctly get the last block of the data
    await iNodeMgr.withTransactionF(fileIno, async (tran) => {
      [idx, block] = await iNodeMgr.fileGetLastBlock(fileIno, tran);
    });
    expect(idx).toBe(2);
    expect(block).toStrictEqual(Buffer.from('r'));
  });
  test('write and read data from a file', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(fileIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(fileIno);
      });
      await iNodeMgr.fileCreate(
        fileIno,
        {
          mode: permissions.DEFAULT_FILE_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        },
        blockSize,
        undefined,
        tran,
      );
      await iNodeMgr.fileSetBlocks(fileIno, buffer, blockSize, undefined, tran);
    });
    let counter = 0;
    const compareBuffer = Buffer.alloc(buffer.length);
    await iNodeMgr.withTransactionF(fileIno, async (tran) => {
      for await (const block of iNodeMgr.fileGetBlocks(
        fileIno,
        blockSize,
        undefined,
        undefined,
        tran,
      )) {
        block.copy(compareBuffer, counter);
        counter += blockSize;
      }
    });
    expect(compareBuffer).toStrictEqual(buffer);
  });
  test('read a single block from a file', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(fileIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(fileIno);
      });
      await iNodeMgr.fileCreate(
        fileIno,
        {
          mode: permissions.DEFAULT_FILE_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        },
        blockSize,
        buffer,
        tran,
      );
    });
    let blockComp;
    await iNodeMgr.withTransactionF(async (tran) => {
      for await (const block of iNodeMgr.fileGetBlocks(
        fileIno,
        blockSize,
        0,
        1,
        tran,
      )) {
        blockComp = block;
      }
    });
    expect(blockComp).toStrictEqual(Buffer.from('Test '));
  });
  test('write a single block from a file', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(fileIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(fileIno);
      });
      await iNodeMgr.fileCreate(
        fileIno,
        {
          mode: permissions.DEFAULT_FILE_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        },
        blockSize,
        undefined,
        tran,
      );
      await iNodeMgr.fileSetBlocks(fileIno, buffer, blockSize, undefined, tran);
    });
    // Write the byte 'B' at the beginning of the first block
    await iNodeMgr.withTransactionF(async (tran) => {
      await iNodeMgr.fileWriteBlock(fileIno, Buffer.from('B'), 0, 0, tran);
    });
    let blockComp;
    // Obtain blocks which have an index greater than or equal to 0 and less than 1
    await iNodeMgr.withTransactionF(async (tran) => {
      for await (const block of iNodeMgr.fileGetBlocks(
        fileIno,
        blockSize,
        0,
        1,
        tran,
      )) {
        blockComp = block;
      }
    });
    expect(blockComp.toString()).toStrictEqual('Best ');
  });
  test('handle accessing blocks that the db does not have', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(fileIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(fileIno);
      });
      await iNodeMgr.fileCreate(
        fileIno,
        {
          mode: permissions.DEFAULT_FILE_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        },
        blockSize,
        buffer,
        tran,
      );
    });
    let counter = 0;
    const compareBuffer = Buffer.alloc(buffer.length);
    await iNodeMgr.withTransactionF(async (tran) => {
      // Database only has blocks 0, 1 and 2 but we take up to block 9
      for await (const block of iNodeMgr.fileGetBlocks(
        fileIno,
        blockSize,
        0,
        10,
        tran,
      )) {
        block.copy(compareBuffer, counter);
        counter += blockSize;
      }
    });
    // Should only be the original buffer
    expect(compareBuffer).toStrictEqual(buffer);
  });
});
