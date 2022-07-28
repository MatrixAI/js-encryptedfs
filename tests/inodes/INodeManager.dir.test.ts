import type { INodeIndex } from '@/inodes/types';
import os from 'os';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { DB } from '@matrixai/db';
import INodeManager from '@/inodes/INodeManager';
import * as utils from '@/utils';
import * as permissions from '@/permissions';

describe('INodeManager Directory', () => {
  const logger = new Logger('INodeManager Directory Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      utils.pathJoin(os.tmpdir(), 'encryptedfs-test-'),
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
  test('create root directory', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(rootIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
      });
      await iNodeMgr.dirCreate(
        rootIno,
        {
          mode: permissions.DEFAULT_ROOT_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        },
        undefined,
        tran,
      );
      const stat = await iNodeMgr.statGet(rootIno, tran);
      expect(stat['ino']).toBe(rootIno);
      expect(stat.isDirectory()).toBe(true);
      expect(stat['uid']).toBe(permissions.DEFAULT_ROOT_UID);
      expect(stat['gid']).toBe(permissions.DEFAULT_ROOT_GID);
      // Root directories should have nlink of 2
      expect(stat['nlink']).toBe(2);
      // All timestamps should be the same at creation
      expect(stat['atime']).toEqual(stat['mtime']);
      expect(stat['mtime']).toEqual(stat['ctime']);
      expect(stat['birthtime']).toEqual(stat['birthtime']);
    });
    await iNodeMgr.withTransactionF(rootIno, async (tran) => {
      const iNode = await iNodeMgr.get(rootIno, tran);
      expect(iNode).toBeDefined();
      expect(iNode!).toEqual({
        ino: rootIno,
        type: 'Directory',
        gc: false,
      });
      const stat = await iNodeMgr.statGet(rootIno, tran);
      expect(stat['ino']).toBe(rootIno);
      const rootIno_ = await iNodeMgr.dirGetEntry(rootIno, '..', tran);
      expect(rootIno_).toBe(rootIno);
    });
  });
  test('create subdirectory', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(rootIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
      });
      await iNodeMgr.dirCreate(
        rootIno,
        {
          mode: permissions.DEFAULT_ROOT_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        },
        undefined,
        tran,
      );
    });
    const childIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(rootIno, childIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(childIno);
      });
      await iNodeMgr.dirCreate(
        childIno,
        {
          mode: permissions.DEFAULT_DIRECTORY_PERM,
        },
        rootIno,
        tran,
      );
      await iNodeMgr.dirSetEntry(rootIno, 'childdir', childIno, tran);
    });
    await iNodeMgr.withTransactionF(async (tran) => {
      const childIno_ = await iNodeMgr.dirGetEntry(rootIno, 'childdir', tran);
      expect(childIno_).toBeDefined();
      expect(childIno_).toBe(childIno);
      const parentIno = await iNodeMgr.dirGetEntry(childIno, '..', tran);
      expect(parentIno).toBeDefined();
      expect(parentIno).toBe(rootIno);
      const statParent = await iNodeMgr.statGet(rootIno, tran);
      expect(statParent['nlink']).toBe(3);
      const statChild = await iNodeMgr.statGet(childIno, tran);
      expect(statChild['nlink']).toBe(2);
    });
  });
  test('create subdirectories', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const rootIno = iNodeMgr.inoAllocate();
    const childIno1 = iNodeMgr.inoAllocate();
    const childIno2 = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(
      rootIno,
      childIno1,
      childIno2,
      async (tran) => {
        tran.queueFailure(() => {
          iNodeMgr.inoDeallocate(rootIno);
          iNodeMgr.inoDeallocate(childIno1);
          iNodeMgr.inoDeallocate(childIno2);
        });
        await iNodeMgr.dirCreate(rootIno, {}, undefined, tran);
        await iNodeMgr.dirCreate(childIno1, {}, rootIno, tran);
        await iNodeMgr.dirCreate(childIno2, {}, rootIno, tran);
      },
    );
    await Promise.all([
      iNodeMgr.withTransactionF(rootIno, childIno1, async (tran) => {
        await iNodeMgr.dirSetEntry(rootIno, 'child1', childIno1, tran);
      }),
      iNodeMgr.withTransactionF(rootIno, childIno2, async (tran) => {
        await iNodeMgr.dirSetEntry(rootIno, 'child2', childIno2, tran);
      }),
    ]);
    await iNodeMgr.withTransactionF(async (tran) => {
      const stat = await iNodeMgr.statGet(rootIno, tran);
      // If the rootIno locking wasn't done
      // this nlink would be clobbered by a race condition
      expect(stat['nlink']).toBe(4);
    });
  });
  test('delete subdirectory', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const rootIno = iNodeMgr.inoAllocate();
    const childIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(rootIno, childIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
        iNodeMgr.inoDeallocate(childIno);
      });
      await iNodeMgr.dirCreate(
        rootIno,
        {
          mode: permissions.DEFAULT_ROOT_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        },
        undefined,
        tran,
      );
      await iNodeMgr.dirCreate(
        childIno,
        {
          mode: permissions.DEFAULT_DIRECTORY_PERM,
        },
        rootIno,
        tran,
      );
      await iNodeMgr.dirSetEntry(rootIno, 'childdir', childIno, tran);
    });
    await iNodeMgr.withTransactionF(rootIno, childIno, async (tran) => {
      await iNodeMgr.dirUnsetEntry(rootIno, 'childdir', tran);
    });
    await iNodeMgr.withTransactionF(async (tran) => {
      const statParent = await iNodeMgr.statGet(rootIno, tran);
      expect(statParent['nlink']).toBe(2);
      expect(
        await iNodeMgr.dirGetEntry(rootIno, 'childdir', tran),
      ).toBeUndefined();
      expect(await iNodeMgr.get(childIno, tran)).toBeUndefined();
    });
  });
  test('rename directory entry', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(rootIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
      });
      await iNodeMgr.dirCreate(rootIno, {}, undefined, tran);
    });
    // We are going to rename over an existing inode
    const childIno1 = iNodeMgr.inoAllocate();
    const childIno2 = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(
      rootIno,
      childIno1,
      childIno2,
      async (tran) => {
        tran.queueFailure(() => {
          iNodeMgr.inoDeallocate(childIno1);
          iNodeMgr.inoDeallocate(childIno2);
        });
        await iNodeMgr.dirCreate(childIno1, {}, rootIno, tran);
        await iNodeMgr.dirCreate(childIno2, {}, rootIno, tran);
        await iNodeMgr.dirSetEntry(rootIno, 'child1', childIno1, tran);
        await iNodeMgr.dirSetEntry(rootIno, 'child2', childIno2, tran);
      },
    );
    await iNodeMgr.withTransactionF(async (tran) => {
      // Parent has 4 nlinks now
      const statParent = await iNodeMgr.statGet(rootIno, tran);
      expect(statParent['nlink']).toBe(4);
    });
    await iNodeMgr.withTransactionF(
      rootIno,
      childIno1,
      childIno2,
      async (tran) => {
        // Perform the renaming!
        await iNodeMgr.dirResetEntry(rootIno, 'child1', 'child2', tran);
      },
    );
    await iNodeMgr.withTransactionF(async (tran) => {
      const statParent = await iNodeMgr.statGet(rootIno, tran);
      expect(statParent['nlink']).toBe(3);
      const childIno1_ = await iNodeMgr.dirGetEntry(rootIno, 'child2', tran);
      expect(childIno1_).toBeDefined();
      expect(childIno1_).toBe(childIno1);
      expect(
        await iNodeMgr.dirGetEntry(rootIno, 'child1', tran),
      ).toBeUndefined();
      expect(await iNodeMgr.get(childIno2, tran)).toBeUndefined();
    });
  });
  test('iterate directory entries', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(rootIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
      });
      await iNodeMgr.dirCreate(rootIno, {}, undefined, tran);
    });
    const childIno1 = iNodeMgr.inoAllocate();
    const childIno2 = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(
      rootIno,
      childIno1,
      childIno2,
      async (tran) => {
        tran.queueFailure(() => {
          iNodeMgr.inoDeallocate(childIno1);
          iNodeMgr.inoDeallocate(childIno2);
        });
        await iNodeMgr.dirCreate(childIno1, {}, rootIno, tran);
        await iNodeMgr.dirCreate(childIno2, {}, rootIno, tran);
        await iNodeMgr.dirSetEntry(rootIno, 'child1', childIno1, tran);
        await iNodeMgr.dirSetEntry(rootIno, 'child2', childIno2, tran);
      },
    );
    const entries: Array<[string, INodeIndex]> = [];
    await iNodeMgr.withTransactionF(rootIno, async (tran) => {
      for await (const [name, ino] of iNodeMgr.dirGet(rootIno, tran)) {
        entries.push([name, ino]);
      }
    });
    expect(entries).toContainEqual(['.', rootIno]);
    expect(entries).toContainEqual(['..', rootIno]);
    expect(entries).toContainEqual(['child1', childIno1]);
    expect(entries).toContainEqual(['child2', childIno2]);
    expect(entries).toHaveLength(4);
  });
});
