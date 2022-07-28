import os from 'os';
import pathNode from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { DB } from '@matrixai/db';
import INodeManager from '@/inodes/INodeManager';
import FileDescriptor from '@/fd/FileDescriptor';
import * as utils from '@/utils';
import * as constants from '@/constants';
import * as permissions from '@/permissions';

describe('File Descriptor', () => {
  const logger = new Logger('File Descriptor', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
  let bytesRead: number;
  let bytesWritten: number;
  const blockSize = 5;
  const origBuffer = Buffer.from('Test Buffer for File Descriptor');
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      pathNode.join(os.tmpdir(), 'encryptedfs-test-'),
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
      // @ts-ignore - version of js-logger is incompatible (remove when js-db updates to 5.* here)
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
  test('create a file descriptor', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    expect(fd).toBeInstanceOf(FileDescriptor);
    expect(fd.pos).toBe(0);
    expect(fd.ino).toBe(fileIno);
    expect(fd.flags).toBe(0);
  });
  test('can set flags', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    fd.flags = constants.O_APPEND;
    expect(fd.flags).toBe(constants.O_APPEND);
  });
  test('can set position', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    // Rejects as the iNode has not been created
    await iNodeMgr.withTransactionF(fileIno, async (tran) => {
      await expect(fd.setPos(1, constants.SEEK_SET, tran)).rejects.toThrow(
        Error,
      );
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
        origBuffer,
        tran,
      );
    });
    await iNodeMgr.withTransactionF(async (tran) => {
      // Rejects as the new position would be a negativ number
      await expect(fd.setPos(-10, 0, tran)).rejects.toThrow(Error);
      // Will seek the absolute position given
      await fd.setPos(5, constants.SEEK_SET, tran);
      expect(fd.pos).toBe(5);
      // Will seek the current position plus the absolute position
      await fd.setPos(5, constants.SEEK_CUR, tran);
      expect(fd.pos).toBe(5 + 5);
      // Will seek the end of the data plus the absolute position
      await fd.setPos(5, constants.SEEK_END, tran);
      expect(fd.pos).toBe(origBuffer.length + 5);
    });
  });
  test('read all the data on the file iNode', async () => {
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length);
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    let atime;
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
        origBuffer,
        tran,
      );
      atime = await iNodeMgr.statGetProp(fileIno, 'atime', tran);
    });
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    bytesRead = await fd.read(readBuffer);
    expect(fd.pos).toBe(origBuffer.length);
    expect(readBuffer).toStrictEqual(origBuffer);
    expect(bytesRead).toBe(readBuffer.length);
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGetProp(fileIno, 'atime', tran);
      expect(stat.getTime()).toBeGreaterThan(atime.getTime());
    });
  });
  test('read with the file descriptor at a certain position', async () => {
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length - 4);
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    let atime;
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
        origBuffer,
        tran,
      );
      atime = await iNodeMgr.statGetProp(fileIno, 'atime', tran);
    });
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    // Start reading from byte number 4
    bytesRead = await fd.read(readBuffer, 4);
    expect(fd.pos).toBe(0);
    expect(readBuffer).toStrictEqual(
      Buffer.from(' Buffer for File Descriptor'),
    );
    expect(bytesRead).toBe(readBuffer.length);
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGetProp(fileIno, 'atime', tran);
      expect(stat.getTime()).toBeGreaterThan(atime.getTime());
    });
  });
  test('read when the return buffer length is less than the data length', async () => {
    // Allocate the size of the buffer to be read into
    const returnBuffer = Buffer.alloc(origBuffer.length - 10);
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    let atime;
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
        origBuffer,
        tran,
      );
      atime = await iNodeMgr.statGetProp(fileIno, 'atime', tran);
    });
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    // Return buffer is only 21 bytes and starts at byte 6
    // so should only reach the 27th byte of the original buffer
    bytesRead = await fd.read(returnBuffer, 6);
    expect(fd.pos).toBe(0);
    expect(returnBuffer).toStrictEqual(Buffer.from('uffer for File Descri'));
    expect(bytesRead).toBe(returnBuffer.length);
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGetProp(fileIno, 'atime', tran);
      expect(stat.getTime()).toBeGreaterThan(atime.getTime());
    });
  });
  test('write to an empty file iNode', async () => {
    const returnBuffer = Buffer.alloc(origBuffer.length);
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    let mtime, ctime;
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
      const stat = await iNodeMgr.statGet(fileIno, tran);
      mtime = stat['mtime'].getTime();
      ctime = stat['ctime'].getTime();
    });
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    bytesWritten = await fd.write(origBuffer);
    expect(fd.pos).toBe(origBuffer.length);
    expect(bytesWritten).toBe(origBuffer.length);
    await fd.read(returnBuffer, 0);
    expect(returnBuffer).toStrictEqual(origBuffer);
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGet(fileIno, tran);
      expect(stat['mtime'].getTime()).toBeGreaterThan(mtime);
      expect(stat['ctime'].getTime()).toBeGreaterThan(ctime);
      expect(stat['size']).toBe(origBuffer.length);
      expect(stat['blocks']).toBe(7);
    });
  });
  test('overwrite a single block of a file iNode', async () => {
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length);
    // Allocate the buffer that will be written
    const overwriteBuffer = Buffer.from('Nice');
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    let mtime, ctime;
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
        origBuffer,
        tran,
      );
      const stat = await iNodeMgr.statGet(fileIno, tran);
      mtime = stat['mtime'].getTime();
      ctime = stat['ctime'].getTime();
    });
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);

    // Overwrite the existing buffer at position 0
    bytesWritten = await fd.write(overwriteBuffer);
    expect(fd.pos).toBe(overwriteBuffer.length);
    expect(bytesWritten).toBe(overwriteBuffer.length);
    await fd.read(readBuffer, 0);
    expect(fd.pos).toBe(overwriteBuffer.length);
    expect(readBuffer).toStrictEqual(
      Buffer.from('Nice Buffer for File Descriptor'),
    );
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGet(fileIno, tran);
      expect(stat['mtime'].getTime()).toBeGreaterThan(mtime);
      expect(stat['ctime'].getTime()).toBeGreaterThan(ctime);
      expect(stat['size']).toBe(origBuffer.length);
      expect(stat['blocks']).toBe(7);
    });
  });
  test('overwrite at an offset to a file iNode', async () => {
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length);
    // Allocate the buffer that will be written
    const overwriteBuffer = Buffer.from('ing Buf');
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    let mtime, ctime;
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
        origBuffer,
        tran,
      );
      const stat = await iNodeMgr.statGet(fileIno, tran);
      mtime = stat['mtime'].getTime();
      ctime = stat['ctime'].getTime();
    });
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);

    // Overwrite the original buffer starting from byte 4
    bytesWritten = await fd.write(overwriteBuffer, 4);
    expect(bytesWritten).toBe(overwriteBuffer.length);
    await fd.read(readBuffer);
    expect(readBuffer).toStrictEqual(
      Buffer.from('Testing Buf for File Descriptor'),
    );
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGet(fileIno, tran);
      expect(stat['mtime'].getTime()).toBeGreaterThan(mtime);
      expect(stat['ctime'].getTime()).toBeGreaterThan(ctime);
      expect(stat['size']).toBe(origBuffer.length);
      expect(stat['blocks']).toBe(7);
    });
  });
  test('write past the end of a file iNode', async () => {
    // Allocate the size of the buffer to be read into
    let readBuffer = Buffer.alloc(origBuffer.length);
    // Allocate the buffer that will be written
    const writeBuffer = Buffer.from('End!');
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    let mtime, ctime;
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
        origBuffer,
        tran,
      );
      const stat = await iNodeMgr.statGet(fileIno, tran);
      mtime = stat['mtime'].getTime();
      ctime = stat['ctime'].getTime();
    });
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);

    // Write to bytes on from the end of the data
    bytesWritten = await fd.write(writeBuffer, origBuffer.length + 2);
    expect(bytesWritten).toBe(writeBuffer.length);
    await fd.read(readBuffer);
    // Check the original buffer has not been overwritten
    expect(readBuffer).toEqual(origBuffer);
    // Read in two bytes on from the end of the original data
    readBuffer = Buffer.alloc(writeBuffer.length);
    await fd.read(readBuffer, origBuffer.length + 2);
    // This should be the buffer that was written
    expect(readBuffer).toEqual(writeBuffer);
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGet(fileIno, tran);
      expect(stat['mtime'].getTime()).toBeGreaterThan(mtime);
      expect(stat['ctime'].getTime()).toBeGreaterThan(ctime);
      expect(stat['size']).toBe(origBuffer.length + writeBuffer.length + 2);
      expect(stat['blocks']).toBe(8);
    });
  });
  test('append data to the file iNode', async () => {
    // Alocate the buffer that will be appended to exceed the block size
    //  Test Buffer for File Descriptor
    // |    |    |    |    |    |    |    |
    //  Test Buffer for File Descriptor Tests
    const appendBufferOver = Buffer.from(' Tests');
    // Allocate the buffer that will be appended to not exceed the block size
    //  Test Buffer for File Descriptor Tests
    // |    |    |    |    |    |    |    |    |
    //  Test Buffer for File Descriptor Testssss
    const appendBufferUnder = Buffer.from('sss');
    // Allocate the size of the buffer to be read into (length of existing data
    // + length of data to be appended)
    let readBuffer = Buffer.alloc(origBuffer.length + appendBufferOver.length);
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fileIno = iNodeMgr.inoAllocate();
    let mtime, ctime;
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
        origBuffer,
        tran,
      );
      const stat = await iNodeMgr.statGet(fileIno, tran);
      mtime = stat['mtime'].getTime();
      ctime = stat['ctime'].getTime();
    });
    const fd = new FileDescriptor(iNodeMgr, fileIno, constants.O_APPEND);

    // Appending data to a non full block which will exceed the block size
    // Fd is append mode so will write from the end (setting the position does
    // nothing for append mode)
    bytesWritten = await fd.write(appendBufferOver, 0);
    expect(fd.pos).toBe(0);
    expect(bytesWritten).toBe(appendBufferOver.length);
    await fd.read(readBuffer, 0);
    expect(fd.pos).toBe(0);
    expect(readBuffer).toStrictEqual(
      Buffer.from('Test Buffer for File Descriptor Tests'),
    );
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGet(fileIno, tran);
      expect(stat['mtime'].getTime()).toBeGreaterThan(mtime);
      mtime = stat['mtime'].getTime();
      expect(stat['ctime'].getTime()).toBeGreaterThan(ctime);
      ctime = stat['ctime'].getTime();
      expect(stat['size']).toBe(origBuffer.length + appendBufferOver.length);
      expect(stat['blocks']).toBe(8);
    });

    // Appending data to a non full block which will not exceed the block size
    // The second argument of 'write' is position and should not do anything when appending
    // so set to 10 to test this
    bytesWritten = await fd.write(appendBufferUnder, 10, constants.O_APPEND);
    expect(fd.pos).toBe(0);
    expect(bytesWritten).toBe(appendBufferUnder.length);
    readBuffer = Buffer.alloc(readBuffer.length + appendBufferUnder.length);
    await fd.read(readBuffer, 0);
    expect(fd.pos).toBe(0);
    expect(readBuffer).toStrictEqual(
      Buffer.from('Test Buffer for File Descriptor Testssss'),
    );
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGet(fileIno, tran);
      expect(stat['mtime'].getTime()).toBeGreaterThan(mtime);
      mtime = stat['mtime'].getTime();
      expect(stat['ctime'].getTime()).toBeGreaterThan(ctime);
      ctime = stat['ctime'].getTime();
      expect(stat['size']).toBe(
        origBuffer.length + appendBufferOver.length + appendBufferUnder.length,
      );
      expect(stat['blocks']).toBe(8);
    });
    // Appending data to a full block which will exceed the block size
    //  Test Buffer for File Descriptor Testssss
    // |    |    |    |    |    |    |    |    |    |
    //  Test Buffer for File Descriptor Testssss Tests
    bytesWritten = await fd.write(appendBufferOver);
    expect(fd.pos).toBe(
      origBuffer.length +
        appendBufferOver.length +
        appendBufferUnder.length +
        appendBufferOver.length,
    );
    expect(bytesWritten).toBe(appendBufferOver.length);
    readBuffer = Buffer.alloc(readBuffer.length + appendBufferOver.length);
    await fd.read(readBuffer, 0);
    expect(fd.pos).toBe(
      origBuffer.length +
        appendBufferOver.length +
        appendBufferUnder.length +
        appendBufferOver.length,
    );
    expect(readBuffer).toStrictEqual(
      Buffer.from('Test Buffer for File Descriptor Testssss Tests'),
    );
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGet(fileIno, tran);
      expect(stat['mtime'].getTime()).toBeGreaterThan(mtime);
      expect(stat['ctime'].getTime()).toBeGreaterThan(ctime);
      expect(stat['size']).toBe(
        origBuffer.length +
          appendBufferOver.length +
          appendBufferUnder.length +
          appendBufferOver.length,
      );
      expect(stat['blocks']).toBe(10);
    });
  });
});
