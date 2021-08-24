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
    await db.destroy();
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
    await iNodeMgr.transact(async (tran) => {
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
    }, [fileIno]);
    let counter = 0;
    // Alocate a buffer that will accept the blocks of the iNode
    const compareBuffer = Buffer.alloc(buffer.length);
    await iNodeMgr.transact(async (tran) => {
      for await (const block of iNodeMgr.fileGetBlocks(tran, fileIno, blockSize)) {
        // Copy the blocks into the compare buffer
        block.copy(compareBuffer, counter);
        counter += blockSize;
      }
    }, [fileIno]);
    expect(compareBuffer).toStrictEqual(buffer);
    let idx, block;
    // Check that we can also correctly get the last block of the data
    await iNodeMgr.transact(async (tran) => {
      [idx, block] = await iNodeMgr.fileGetLastBlock(tran, fileIno);
    }, [fileIno]);
    expect(idx).toBe(2);
    expect(block).toStrictEqual(Buffer.from('r'));
  });
  test('write and read data from a file', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
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
      await iNodeMgr.fileSetBlocks(tran, fileIno, buffer, blockSize);
    }, [fileIno]);
    let counter = 0;
    const compareBuffer = Buffer.alloc(buffer.length);
    await iNodeMgr.transact(async (tran) => {
      for await (const block of iNodeMgr.fileGetBlocks(tran, fileIno, blockSize)) {
        block.copy(compareBuffer, counter);
        counter += blockSize;
      }
    }, [fileIno]);
    expect(compareBuffer).toStrictEqual(buffer);
  });
  test('read a single block from a file', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
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
    }, [fileIno]);
    let blockComp;
    await iNodeMgr.transact(async (tran) => {
      for await (const block of iNodeMgr.fileGetBlocks(tran, fileIno, blockSize, 0, 1)) {
        blockComp = block;
      }
    });
    expect(blockComp).toStrictEqual(Buffer.from('Test '));
  });
  test('write a single block from a file', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
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
      await iNodeMgr.fileSetBlocks(tran, fileIno, buffer, blockSize);
    }, [fileIno]);
    // Write the byte 'B' at the beginning of the first block
    await iNodeMgr.transact(async (tran) => {
      await iNodeMgr.fileWriteBlock(tran, fileIno, Buffer.from('B'), 0, 0);
    });
    let blockComp;
    // Obtain blocks which have an index greater than or equal to 0 and less than 1
    await iNodeMgr.transact(async (tran) => {
      for await (const block of iNodeMgr.fileGetBlocks(tran, fileIno, blockSize, 0, 1)) {
        blockComp = block;
      }
    });
    expect(blockComp.toString()).toStrictEqual('Best ');
  });
  test('handle accessing blocks that the db does not have', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
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
    }, [fileIno]);
    let counter = 0;
    const compareBuffer = Buffer.alloc(buffer.length);
    await iNodeMgr.transact(async (tran) => {
      // Database only has blocks 0, 1 and 2 but we take up to block 9
      for await (const block of iNodeMgr.fileGetBlocks(tran, fileIno, blockSize, 0, 10)) {
        block.copy(compareBuffer, counter);
        counter += blockSize;
      }
    });
    // Should only be the original buffer
    expect(compareBuffer).toStrictEqual(buffer);
  });
});
