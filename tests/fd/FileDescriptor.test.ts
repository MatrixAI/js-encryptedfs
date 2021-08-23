import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import { FileDescriptor } from '@/fd';
import * as utils from '@/utils';

describe('INodeManager File', () => {
  const logger = new Logger('INodeManager File Test', LogLevel.WARN, [new StreamHandler()]);
  const devMgr = new vfs.DeviceManager();
  let dataDir: string;
  let db: DB;
  let dbKey: Buffer = utils.generateKeySync(256);
  let blockSize = 5;
  const buffer = Buffer.from('Test Buffer for File Descriptor');
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
  test('create a file descriptor', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    expect(fd).toBeInstanceOf(FileDescriptor);
  });
  test('read all the data on the file iNode', async () => {
    const returnBuffer = Buffer.alloc(buffer.length);
    let bytesRead;
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
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    bytesRead = await fd.read(returnBuffer);
    expect(returnBuffer).toStrictEqual(buffer);
    expect(bytesRead).toBe(returnBuffer.length);
  });
  test('start the file descriptor at a certain position', async () => {
    const returnBuffer = Buffer.alloc(buffer.length - 4);
    let bytesRead;
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
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    bytesRead = await fd.read(returnBuffer, 4);
    const retBuffer = Buffer.from(' Buffer for File Descriptor');
    expect(returnBuffer).toStrictEqual(retBuffer);
    expect(bytesRead).toBe(returnBuffer.length);
  });
  test('return buffer length is less than the data length', async () => {
    const returnBuffer = Buffer.alloc(buffer.length - 10);
    let bytesRead;
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
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    bytesRead = await fd.read(returnBuffer, 6);
    const retBuffer = Buffer.from('uffer for File Descri');
    expect(returnBuffer).toStrictEqual(retBuffer);
    expect(bytesRead).toBe(returnBuffer.length);
  });
});
