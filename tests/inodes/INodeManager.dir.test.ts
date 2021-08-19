import type { INodeIndex } from '@/inodes/types';

import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import * as utils from '@/utils';

describe('INodeManager Directory', () => {
  const logger = new Logger('INodeManager Directory Test', LogLevel.WARN, [new StreamHandler()]);
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
    await db.destroy();
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test('create root directory', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger
    });
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
      });
      await iNodeMgr.dirCreate(tran, rootIno, {
        mode: vfs.DEFAULT_ROOT_PERM,
        uid: vfs.DEFAULT_ROOT_UID,
        gid: vfs.DEFAULT_ROOT_GID
      });
      const stat = await iNodeMgr.statGet(tran, rootIno);
      expect(stat['ino']).toBe(rootIno);
      expect(stat.isDirectory()).toBe(true);
      expect(stat['uid']).toBe(vfs.DEFAULT_ROOT_UID);
      expect(stat['gid']).toBe(vfs.DEFAULT_ROOT_GID);
      // root directories should have nlink of 2
      expect(stat['nlink']).toBe(2);
      // all timestamps should be the same at creation
      expect(stat['atime']).toEqual(stat['mtime']);
      expect(stat['mtime']).toEqual(stat['ctime']);
      expect(stat['birthtime']).toEqual(stat['birthtime']);
    }, [rootIno]);
    await iNodeMgr.transact(async (tran) => {
      const iNode = await iNodeMgr.get(tran, rootIno);
      expect(iNode).toBeDefined();
      expect(iNode!).toEqual({
        ino: rootIno,
        type: 'Directory',
        gc: false
      });
      const stat = await iNodeMgr.statGet(tran, rootIno);
      expect(stat['ino']).toBe(rootIno);
      const rootIno_ = await iNodeMgr.dirGetEntry(tran, rootIno, '..');
      expect(rootIno_).toBe(rootIno);
    }, [rootIno]);
  });
  test('create subdirectory', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger
    });
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
      });
      await iNodeMgr.dirCreate(tran, rootIno, {
        mode: vfs.DEFAULT_ROOT_PERM,
        uid: vfs.DEFAULT_ROOT_UID,
        gid: vfs.DEFAULT_ROOT_GID
      });
    }, [rootIno]);
    const childIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(childIno);
      });
      await iNodeMgr.dirCreate(tran, childIno, {
        mode: vfs.DEFAULT_DIRECTORY_PERM
      }, rootIno);
      await iNodeMgr.dirSetEntry(
        tran,
        rootIno,
        'childdir',
        childIno
      );
    }, [rootIno, childIno]);
    await iNodeMgr.transact(async (tran) => {
      const childIno_ = await iNodeMgr.dirGetEntry(
        tran,
        rootIno,
        'childdir'
      );
      expect(childIno_).toBeDefined();
      expect(childIno_).toBe(childIno);
      const parentIno = await iNodeMgr.dirGetEntry(tran, childIno, '..');
      expect(parentIno).toBeDefined();
      expect(parentIno).toBe(rootIno);
      const statParent = await iNodeMgr.statGet(tran, rootIno);
      expect(statParent['nlink']).toBe(3);
      const statChild = await iNodeMgr.statGet(tran, childIno);
      expect(statChild['nlink']).toBe(2);
    });
  });
  test('create subdirectories', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger
    });
    const rootIno = iNodeMgr.inoAllocate();
    const childIno1 = iNodeMgr.inoAllocate();
    const childIno2 = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
        iNodeMgr.inoDeallocate(childIno1);
        iNodeMgr.inoDeallocate(childIno2);
      });
      await iNodeMgr.dirCreate(tran, rootIno, {});
      await iNodeMgr.dirCreate(tran, childIno1, {}, rootIno);
      await iNodeMgr.dirCreate(tran, childIno2, {}, rootIno);
    }, [rootIno, childIno1, childIno2]);
    await Promise.all([
      iNodeMgr.transact(async (tran) => {
        await iNodeMgr.dirSetEntry(tran, rootIno, 'child1', childIno1);
      }, [rootIno, childIno1]),
      iNodeMgr.transact(async (tran) => {
        await iNodeMgr.dirSetEntry(tran, rootIno, 'child2', childIno2);
      }, [rootIno, childIno2])
    ]);
    await iNodeMgr.transact(async (tran) => {
      const stat = await iNodeMgr.statGet(tran, rootIno);
      // if the rootIno locking wasn't done
      // this nlink would be clobbered by a race condition
      expect(stat['nlink']).toBe(4);
    });
  });
  test('delete subdirectory', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger
    });
    const rootIno = iNodeMgr.inoAllocate();
    const childIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
        iNodeMgr.inoDeallocate(childIno);
      });
      await iNodeMgr.dirCreate(tran, rootIno, {
        mode: vfs.DEFAULT_ROOT_PERM,
        uid: vfs.DEFAULT_ROOT_UID,
        gid: vfs.DEFAULT_ROOT_GID
      });
      await iNodeMgr.dirCreate(tran, childIno, {
        mode: vfs.DEFAULT_DIRECTORY_PERM
      }, rootIno);
      await iNodeMgr.dirSetEntry(
        tran,
        rootIno,
        'childdir',
        childIno
      );
    }, [rootIno, childIno]);
    await iNodeMgr.transact(async (tran) => {
      await iNodeMgr.dirUnsetEntry(tran, rootIno, 'childdir');
    }, [rootIno, childIno]);
    await iNodeMgr.transact(async (tran) => {
      const statParent = await iNodeMgr.statGet(tran, rootIno);
      expect(statParent['nlink']).toBe(2);
      expect(await iNodeMgr.dirGetEntry(tran, rootIno, 'childdir')).toBeUndefined();
      expect(await iNodeMgr.get(tran, childIno)).toBeUndefined();
    });
  });
  test('rename directory entry', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger
    });
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
      });
      await iNodeMgr.dirCreate(tran, rootIno, {});
    }, [rootIno]);
    // we are going to rename over an existing inode
    const childIno1 = iNodeMgr.inoAllocate();
    const childIno2 = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(childIno1);
        iNodeMgr.inoDeallocate(childIno2);
      });
      await iNodeMgr.dirCreate(tran, childIno1, {}, rootIno);
      await iNodeMgr.dirCreate(tran, childIno2, {}, rootIno);
      await iNodeMgr.dirSetEntry(tran, rootIno, 'child1', childIno1);
      await iNodeMgr.dirSetEntry(tran, rootIno, 'child2', childIno2);
    }, [rootIno, childIno1, childIno2]);
    await iNodeMgr.transact(async (tran) => {
      // parent has 4 nlinks now
      const statParent = await iNodeMgr.statGet(tran, rootIno);
      expect(statParent['nlink']).toBe(4);
    });
    await iNodeMgr.transact(async (tran) => {
      // perform the renaming!
      await iNodeMgr.dirResetEntry(tran, rootIno, 'child1', 'child2');
    }, [rootIno, childIno1, childIno2]);
    await iNodeMgr.transact(async (tran) => {
      const statParent = await iNodeMgr.statGet(tran, rootIno);
      expect(statParent['nlink']).toBe(3);
      const childIno1_ = await iNodeMgr.dirGetEntry(tran, rootIno, 'child2');
      expect(childIno1_).toBeDefined();
      expect(childIno1_).toBe(childIno1);
      expect(await iNodeMgr.dirGetEntry(tran, rootIno, 'child1')).toBeUndefined();
      expect(await iNodeMgr.get(tran, childIno2)).toBeUndefined();
    });
  });
  test('iterate directory entries', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger
    });
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
      });
      await iNodeMgr.dirCreate(tran, rootIno, {});
    }, [rootIno]);
    const childIno1 = iNodeMgr.inoAllocate();
    const childIno2 = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(childIno1);
        iNodeMgr.inoDeallocate(childIno2);
      });
      await iNodeMgr.dirCreate(tran, childIno1, {}, rootIno);
      await iNodeMgr.dirCreate(tran, childIno2, {}, rootIno);
      await iNodeMgr.dirSetEntry(tran, rootIno, 'child1', childIno1);
      await iNodeMgr.dirSetEntry(tran, rootIno, 'child2', childIno2);
    }, [rootIno, childIno1, childIno2]);
    const entries: Array<[string, INodeIndex]> = [];
    await iNodeMgr.transact(async (tran) => {
      for await (const [name, ino] of iNodeMgr.dirGet(tran, rootIno)) {
        entries.push([name, ino]);
      }
    }, [rootIno]);
    expect(entries).toContainEqual(['.', rootIno]);
    expect(entries).toContainEqual(['..', rootIno]);
    expect(entries).toContainEqual(['child1', childIno1]);
    expect(entries).toContainEqual(['child2', childIno2]);
    expect(entries).toHaveLength(4);
  });
});
