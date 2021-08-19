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
  test('create a file INode', async () => {
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
    });
  });
  test('access data in a file INode', async () => {
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
      await iNodeMgr.fileSetData(tran, fileIno, Buffer.from('Test Buffer'), 2);
      for await (const block of iNodeMgr.fileGetBlocks(tran, fileIno)) {
        console.log(block)
      }
    });
  });
});
