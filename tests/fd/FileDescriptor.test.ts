import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import { FileDescriptor } from '@/fd';
import * as utils from '@/utils';

describe('File Descriptor', () => {
  const logger = new Logger('File Descriptor', LogLevel.WARN, [new StreamHandler()]);
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
    expect(fd.pos).toBe(0);
    expect(fd.ino).toBe(fileIno);
    expect(fd.flags).toBe(0);
  });
  test('can set flags', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    fd.flags = vfs.constants.O_APPEND;
    expect(fd.flags).toBe(vfs.constants.O_APPEND);
  });
  test('can set position', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    // Rejects as the iNode has not been created
    await expect(fd.setPos(1, vfs.constants.SEEK_SET)).rejects.toThrow(Error);
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
    // Rejects as the new position would be a negativ number
    await expect(fd.setPos(-10, 0)).rejects.toThrow(Error);
    // Will seek the absolute position given
    await fd.setPos(5, vfs.constants.SEEK_SET);
    expect(fd.pos).toBe(5);
    // Will seek the current position plus the absolute position
    await fd.setPos(5, vfs.constants.SEEK_CUR);
    expect(fd.pos).toBe(5 + 5);
    // Will seek the end of the data plus the absolute position
    await fd.setPos(5, vfs.constants.SEEK_END);
    expect(fd.pos).toBe(origBuffer.length + 5);
  });
  test('read all the data on the file iNode', async () => {
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length);
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    let atime;
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
      atime = await iNodeMgr.statGetProp(tran, fileIno, 'atime');
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    bytesRead = await fd.read(readBuffer);
    expect(fd.pos).toBe(origBuffer.length);
    expect(readBuffer).toStrictEqual(origBuffer);
    expect(bytesRead).toBe(readBuffer.length);
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGetProp(tran, fileIno, 'atime');
      expect(stat.getTime()).toBeGreaterThan(atime.getTime());
    });
  });
  test('read with the file descriptor at a certain position', async () => {
    // Allocate the size of the buffer to be read into
    const readBuffer = Buffer.alloc(origBuffer.length - 4);
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    let atime;
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
      atime = await iNodeMgr.statGetProp(tran, fileIno, 'atime');
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    // Start reading from byte number 4
    bytesRead = await fd.read(readBuffer, 4);
    expect(fd.pos).toBe(0);
    expect(readBuffer).toStrictEqual(Buffer.from(' Buffer for File Descriptor'));
    expect(bytesRead).toBe(readBuffer.length);
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGetProp(tran, fileIno, 'atime');
      expect(stat.getTime()).toBeGreaterThan(atime.getTime());
    });
  });
  test('read when the return buffer length is less than the data length', async () => {
    // Allocate the size of the buffer to be read into
    const returnBuffer = Buffer.alloc(origBuffer.length - 10);
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    let atime;
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
      atime = await iNodeMgr.statGetProp(tran, fileIno, 'atime');
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    // Return buffer is only 21 bytes and starts at byte 6
    // so should only reach the 27th byte of the original buffer
    bytesRead = await fd.read(returnBuffer, 6);
    expect(fd.pos).toBe(0);
    expect(returnBuffer).toStrictEqual(Buffer.from('uffer for File Descri'));
    expect(bytesRead).toBe(returnBuffer.length);
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGetProp(tran, fileIno, 'atime');
      expect(stat.getTime()).toBeGreaterThan(atime.getTime());
    });
  });
  test('write to an empty file iNode', async () => {
    const returnBuffer = Buffer.alloc(origBuffer.length);
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    let mtime, ctime;
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
      const stat = await iNodeMgr.statGet(tran, fileIno);
      mtime = stat['mtime'].getTime();
      ctime = stat['ctime'].getTime();
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);
    bytesWritten = await fd.write(origBuffer);
    expect(fd.pos).toBe(origBuffer.length);
    expect(bytesWritten).toBe(origBuffer.length);
    await fd.read(returnBuffer, 0);
    expect(returnBuffer).toStrictEqual(origBuffer);
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGet(tran, fileIno);
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
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    let mtime, ctime;
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
      const stat = await iNodeMgr.statGet(tran, fileIno);
      mtime = stat['mtime'].getTime();
      ctime = stat['ctime'].getTime();
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);

    // Overwrite the existing buffer at position 0
    bytesWritten = await fd.write(overwriteBuffer);
    expect(fd.pos).toBe(overwriteBuffer.length);
    expect(bytesWritten).toBe(overwriteBuffer.length);
    await fd.read(readBuffer, 0);
    expect(fd.pos).toBe(overwriteBuffer.length);
    expect(readBuffer).toStrictEqual(Buffer.from('Nice Buffer for File Descriptor'));
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGet(tran, fileIno);
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
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    let mtime, ctime;
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
      const stat = await iNodeMgr.statGet(tran, fileIno);
      mtime = stat['mtime'].getTime();
      ctime = stat['ctime'].getTime();
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, 0);

    // Overwrite the original buffer starting from byte 4
    bytesWritten = await fd.write(overwriteBuffer, 4);
    expect(bytesWritten).toBe(overwriteBuffer.length);
    await fd.read(readBuffer);
    expect(readBuffer).toStrictEqual(Buffer.from('Testing Buf for File Descriptor'));
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGet(tran, fileIno);
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
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const fileIno = iNodeMgr.inoAllocate();
    let mtime, ctime;
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
      const stat = await iNodeMgr.statGet(tran, fileIno);
      mtime = stat['mtime'].getTime();
      ctime = stat['ctime'].getTime();
    }, [fileIno]);
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
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGet(tran, fileIno);
      expect(stat['mtime'].getTime()).toBeGreaterThan(mtime);
      expect(stat['ctime'].getTime()).toBeGreaterThan(ctime);
      expect(stat['size']).toBe(origBuffer.length + writeBuffer.length + 2);
      expect(stat['blocks']).toBe(8);
    });
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
    let mtime, ctime;
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
      const stat = await iNodeMgr.statGet(tran, fileIno);
      mtime = stat['mtime'].getTime();
      ctime = stat['ctime'].getTime();
    }, [fileIno]);
    const fd = new FileDescriptor(iNodeMgr, fileIno, vfs.constants.O_APPEND);

    // Appending data to a non full block which will exceed the block size
    bytesWritten = await fd.write(appendBufferOver, 0);
    expect(fd.pos).toBe(0);
    expect(bytesWritten).toBe(appendBufferOver.length);
    await fd.read(readBuffer, 0);
    expect(fd.pos).toBe(0);
    expect(readBuffer).toStrictEqual(Buffer.from('Test Buffer for File Descriptor Tests'));
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGet(tran, fileIno);
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
    bytesWritten = await fd.write(appendBufferUnder, 10, vfs.constants.O_APPEND);
    expect(fd.pos).toBe(0);
    expect(bytesWritten).toBe(appendBufferUnder.length);
    readBuffer = Buffer.alloc(readBuffer.length + appendBufferUnder.length);
    await fd.read(readBuffer, 0);
    expect(fd.pos).toBe(0);
    expect(readBuffer).toStrictEqual(Buffer.from('Test Buffer for File Descriptor Testssss'));
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGet(tran, fileIno);
      expect(stat['mtime'].getTime()).toBeGreaterThan(mtime);
      mtime = stat['mtime'].getTime();
      expect(stat['ctime'].getTime()).toBeGreaterThan(ctime);
      ctime = stat['ctime'].getTime();
      expect(stat['size']).toBe(origBuffer.length + appendBufferOver.length + appendBufferUnder.length);
      expect(stat['blocks']).toBe(8);
    });
    // Appending data to a full block which will exceed the block size
    bytesWritten = await fd.write(appendBufferOver);
    expect(fd.pos).toBe(origBuffer.length + appendBufferOver.length + appendBufferUnder.length + appendBufferOver.length);
    expect(bytesWritten).toBe(appendBufferOver.length);
    readBuffer = Buffer.alloc(readBuffer.length + appendBufferOver.length);
    await fd.read(readBuffer, 0);
    expect(fd.pos).toBe(origBuffer.length + appendBufferOver.length + appendBufferUnder.length + appendBufferOver.length);
    expect(readBuffer).toStrictEqual(Buffer.from('Test Buffer for File Descriptor Testssss Tests'));
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGet(tran, fileIno);
      expect(stat['mtime'].getTime()).toBeGreaterThan(mtime);
      expect(stat['ctime'].getTime()).toBeGreaterThan(ctime);
      expect(stat['size']).toBe(origBuffer.length + appendBufferOver.length + appendBufferUnder.length + appendBufferOver.length);
      expect(stat['blocks']).toBe(10);
    });
  });
  test.skip('write to CharacterDev iNode', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const charDevIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(charDevIno);
      });
      await iNodeMgr.charDevCreate(
        tran,
        charDevIno,
        {
          rdev: vfs.mkDev(1, 3)
        }
      );
    }, [charDevIno]);
    const fd = new FileDescriptor(iNodeMgr, charDevIno, 0);
    bytesWritten = await fd.write(origBuffer);
  });
});
