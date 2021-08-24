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
  let bytesRead: number;
  let bytesWritten: number;
  const origBuffer = Buffer.from('Test Buffer for File Descriptor');
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
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length);
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
        origBuffer,
      );
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    bytesRead = await fd.read(readBuffer);
    expect(readBuffer).toStrictEqual(origBuffer);
    expect(bytesRead).toBe(readBuffer.length);
  });
  test('read with the file descriptor at a certain position', async () => {
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length - 4);
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
        origBuffer,
      );
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    // Start reading from byte number 4
    bytesRead = await fd.read(readBuffer, 4);
    expect(readBuffer).toStrictEqual(Buffer.from(' Buffer for File Descriptor'));
    expect(bytesRead).toBe(readBuffer.length);
  });
  test('read when the return buffer length is less than the data length', async () => {
    // Allocate the size of the buffer to be read into
    const returnBuffer = Buffer.alloc(origBuffer.length - 10);
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
        origBuffer,
      );
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    // Return buffer is only 21 bytes and starts at byte 6
    // so should only reach the 27th byte of the original buffer
    bytesRead = await fd.read(returnBuffer, 6);
    expect(returnBuffer).toStrictEqual(Buffer.from('uffer for File Descri'));
    expect(bytesRead).toBe(returnBuffer.length);
  });
  test('write to an empty file iNode', async () => {
    const returnBuffer = Buffer.alloc(origBuffer.length);
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
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    bytesWritten = await fd.write(origBuffer);
    expect(bytesWritten).toBe(origBuffer.length);
    await fd.read(returnBuffer);
    expect(returnBuffer).toStrictEqual(origBuffer);
  });
  test('overwrite a single block of a file iNode', async () => {
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length);
    // Allocate the buffer that will be written
    const overwriteBuffer = Buffer.from('Nice');
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
        origBuffer,
      );
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);

    // Overwrite the existing buffer at position 0
    bytesWritten = await fd.write(overwriteBuffer);
    expect(bytesWritten).toBe(overwriteBuffer.length);
    await fd.read(readBuffer);
    expect(readBuffer).toStrictEqual(Buffer.from('Nice Buffer for File Descriptor'));
  });
  test('overwrite at an offset to a file iNode', async () => {
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length);
    // Allocate the buffer that will be written
    const overwriteBuffer = Buffer.from('ing Buf');
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
        origBuffer,
      );
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);

    // Overwrite the original buffer starting from byte 4
    bytesWritten = await fd.write(overwriteBuffer, 4);
    expect(bytesWritten).toBe(overwriteBuffer.length);
    await fd.read(readBuffer);
    expect(readBuffer).toStrictEqual(Buffer.from('Testing Buf for File Descriptor'));
  });
  test('append data to the file iNode', async () => {
    // Alocate the buffer that will be appended to exceed the block size
    const appendBufferOver = Buffer.from(' Tests');
    // Allocate the buffer that will be appended to not exceed the block size
    const appendBufferUnder = Buffer.from('sss');
    // Allocate the size of the buffer to be read into
    let readBuffer = Buffer.alloc(origBuffer.length + appendBufferOver.length);
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
        origBuffer,
      );
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);

    // Appending data to a non full block which will exceed the block size
    bytesWritten = await fd.write(appendBufferOver, 0, vfs.constants.O_APPEND);
    expect(bytesWritten).toBe(appendBufferOver.length);
    await fd.read(readBuffer);
    expect(readBuffer).toStrictEqual(Buffer.from('Test Buffer for File Descriptor Tests'));

    // Appending data to a non full block which will not exceed the block size
    // The second argument of 'write' is position and should not do anything when appending
    // so set to 10 to test this
    bytesWritten = await fd.write(appendBufferUnder, 10, vfs.constants.O_APPEND);
    expect(bytesWritten).toBe(appendBufferUnder.length);
    readBuffer = Buffer.alloc(readBuffer.length + appendBufferUnder.length);
    await fd.read(readBuffer);
    expect(readBuffer).toStrictEqual(Buffer.from('Test Buffer for File Descriptor Testssss'));

    // Appending data to a full block which will exceed the block size
    bytesWritten = await fd.write(appendBufferOver, 0, vfs.constants.O_APPEND);
    expect(bytesWritten).toBe(appendBufferOver.length);
    readBuffer = Buffer.alloc(readBuffer.length + appendBufferOver.length);
    await fd.read(readBuffer);
    expect(readBuffer).toStrictEqual(Buffer.from('Test Buffer for File Descriptor Testssss Tests'));
  });
});
