import os from 'os';
import pathNode from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { DB } from '@matrixai/db';
import { INodeManager } from '@/inodes';
import FileDescriptorManager from '@/fd/FileDescriptorManager';
import FileDescriptor from '@/fd/FileDescriptor';
import * as permissions from '@/permissions';
import * as utils from '@/utils';

describe('File Descriptor Manager', () => {
  const logger = new Logger('File Descriptor Manager Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
  let bytesRead: number;
  let bytesWritten: number;
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
  test('create a file descriptor manager', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fdMgr = new FileDescriptorManager(iNodeMgr);
    expect(fdMgr).toBeInstanceOf(FileDescriptorManager);
  });
  test('create a file descriptor', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fdMgr = new FileDescriptorManager(iNodeMgr);
    const fileIno = iNodeMgr.inoAllocate();
    const [fd, fdIndex] = await fdMgr.createFd(fileIno, 0);
    expect(fd).toBeInstanceOf(FileDescriptor);
    expect(typeof fdIndex).toBe('number');
  });
  test('retreive a file descriptor', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fdMgr = new FileDescriptorManager(iNodeMgr);
    const fileIno = iNodeMgr.inoAllocate();
    const [fd, fdIndex] = await fdMgr.createFd(fileIno, 0);
    const fdDup = fdMgr.getFd(fdIndex);
    expect(fd).toBe(fdDup);
  });
  test('delete a file descriptor', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fdMgr = new FileDescriptorManager(iNodeMgr);
    const fileIno = iNodeMgr.inoAllocate();
    const [_fd, fdIndex] = await fdMgr.createFd(fileIno, 0);
    await fdMgr.deleteFd(fdIndex);
    const fdDup = fdMgr.getFd(fdIndex);
    expect(fdDup).toBeUndefined();
  });
  test('duplicate a file descriptor', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fdMgr = new FileDescriptorManager(iNodeMgr);
    const fileIno = iNodeMgr.inoAllocate();
    const [fd, fdIndex] = await fdMgr.createFd(fileIno, 0);
    const fdDupIndex = fdMgr.dupFd(fdIndex);
    expect(fdDupIndex).not.toBe(fdIndex);
    if (!fdDupIndex) {
      throw Error('Duplicate Index Undefined');
    }
    const fdDup = fdMgr.getFd(fdDupIndex);
    expect(fd).toBe(fdDup);
  });
  test('read/write to fd when inode deleted from directory', async () => {
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length);
    // Allocate the buffer that will be written
    const overwriteBuffer = Buffer.from('Nice');
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const fdMgr = new FileDescriptorManager(iNodeMgr);
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(rootIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
      });
      await iNodeMgr.dirCreate(rootIno, {}, undefined, tran);
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
        4096,
        origBuffer,
        tran,
      );
    });
    // The file is 'added' to the directory
    await iNodeMgr.withTransactionF(rootIno, fileIno, async (tran) => {
      await iNodeMgr.dirSetEntry(rootIno, 'file', fileIno, tran);
    });
    // The ref to the file iNode is made here
    const [fd, fdIndex] = await fdMgr.createFd(fileIno, 0);
    // The file is 'deleted' from the directory
    await iNodeMgr.withTransactionF(rootIno, fileIno, async (tran) => {
      await iNodeMgr.dirUnsetEntry(rootIno, 'file', tran);
    });
    bytesRead = await fd.read(readBuffer);
    expect(fd.pos).toBe(origBuffer.length);
    expect(readBuffer).toStrictEqual(origBuffer);
    expect(bytesRead).toBe(readBuffer.length);
    // Overwrite the existing buffer at position 0
    bytesWritten = await fd.write(overwriteBuffer, 0);
    expect(fd.pos).toBe(origBuffer.length);
    expect(bytesWritten).toBe(overwriteBuffer.length);
    await fd.read(readBuffer, 0);
    expect(fd.pos).toBe(origBuffer.length);
    expect(readBuffer).toStrictEqual(
      Buffer.from('Nice Buffer for File Descriptor'),
    );
    // Now the file iNode is unreffed through the fd
    await fdMgr.deleteFd(fdIndex);
    // When the fd attempts a read (or write), an Error should be thrown
    const emptyBuffer = Buffer.alloc(origBuffer.length);
    await expect(fd.read(emptyBuffer, 0)).rejects.toThrow(Error);
  });
});
