import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import * as utils from '@/utils';
import { permissions } from '@/constants';

describe('INodeManager', () => {
  const logger = new Logger('INodeManager Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const devMgr = new vfs.DeviceManager();
  let dataDir: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    db = await DB.createDB({
      dbKey,
      dbPath: `${dataDir}/db`,
      logger,
    });
  });
  afterEach(async () => {
    await db.stop();
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test('inode manager is persistent across restarts', async () => {
    let iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger,
    });
    const rootIno = iNodeMgr.inoAllocate();
    const childIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(
      async (tran) => {
        tran.queueFailure(() => {
          iNodeMgr.inoDeallocate(rootIno);
          iNodeMgr.inoDeallocate(childIno);
        });
        await iNodeMgr.dirCreate(tran, rootIno, {});
        await iNodeMgr.dirCreate(tran, childIno, {}, rootIno);
        await iNodeMgr.dirSetEntry(tran, rootIno, 'childdir', childIno);
      },
      [rootIno, childIno],
    );
    await db.stop();
    db = await DB.createDB({
      dbKey,
      dbPath: `${dataDir}/db`,
      logger,
    });
    iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger,
    });
    await iNodeMgr.transact(async (tran) => {
      const rootIno_ = await iNodeMgr.dirGetRoot(tran);
      expect(rootIno_).toBeDefined();
      expect(rootIno_).toBe(rootIno);
      const childIno_ = await iNodeMgr.dirGetEntry(tran, rootIno, 'childdir');
      expect(childIno_).toBeDefined();
      expect(childIno_).toBe(childIno);
    });
  });
  test('transactions are locked via inodes', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger,
    });
    // Demonstrate a counter increment race condition
    await iNodeMgr.transact(async (tran) => {
      await tran.put(iNodeMgr.mgrDomain, 'test', 0);
    });
    await Promise.all([
      iNodeMgr.transact(async (tran) => {
        const num = (await tran.get<number>(iNodeMgr.mgrDomain, 'test'))!;
        await tran.put(iNodeMgr.mgrDomain, 'test', num + 1);
      }),
      iNodeMgr.transact(async (tran) => {
        const num = (await tran.get<number>(iNodeMgr.mgrDomain, 'test'))!;
        await tran.put(iNodeMgr.mgrDomain, 'test', num + 1);
      }),
    ]);
    await iNodeMgr.transact(async (tran) => {
      const num = (await tran.get<number>(iNodeMgr.mgrDomain, 'test'))!;
      // Race condition clobbers the counter
      expect(num).toBe(1);
    });
    // Now with proper locking, the race condition doesn't happen
    await iNodeMgr.transact(async (tran) => {
      await tran.put(iNodeMgr.mgrDomain, 'test', 0);
    });
    const ino = iNodeMgr.inoAllocate();
    await Promise.all([
      iNodeMgr.transact(
        async (tran) => {
          const num = (await tran.get<number>(iNodeMgr.mgrDomain, 'test'))!;
          await tran.put(iNodeMgr.mgrDomain, 'test', num + 1);
        },
        [ino],
      ),
      iNodeMgr.transact(
        async (tran) => {
          const num = (await tran.get<number>(iNodeMgr.mgrDomain, 'test'))!;
          await tran.put(iNodeMgr.mgrDomain, 'test', num + 1);
        },
        [ino],
      ),
    ]);
    await iNodeMgr.transact(async (tran) => {
      const num = (await tran.get<number>(iNodeMgr.mgrDomain, 'test'))!;
      // Race condition is solved by the locking the ino
      expect(num).toBe(2);
    });
  });
  test('inodes can be scheduled for deletion when there are references to them', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger,
    });
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(
      async (tran) => {
        tran.queueFailure(() => {
          iNodeMgr.inoDeallocate(rootIno);
        });
        await iNodeMgr.dirCreate(tran, rootIno, {
          mode: permissions.DEFAULT_ROOT_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        });
      },
      [rootIno],
    );
    const childIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(
      async (tran) => {
        tran.queueFailure(() => {
          iNodeMgr.inoDeallocate(childIno);
        });
        await iNodeMgr.dirCreate(
          tran,
          childIno,
          {
            mode: permissions.DEFAULT_DIRECTORY_PERM,
          },
          rootIno,
        );
        await iNodeMgr.dirSetEntry(tran, rootIno, 'childdir', childIno);
      },
      [rootIno, childIno],
    );
    await iNodeMgr.transact(
      async (tran) => {
        iNodeMgr.ref(childIno);
        await iNodeMgr.dirUnsetEntry(tran, rootIno, 'childdir');
      },
      [rootIno, childIno],
    );
    await iNodeMgr.transact(async (tran) => {
      const data = await iNodeMgr.get(tran, childIno);
      expect(data).toBeDefined();
      expect(data!.gc).toBe(true);
      expect(data!.ino).toBe(childIno);
    });
    await iNodeMgr.transact(async (tran) => {
      await iNodeMgr.unref(tran, childIno);
    });
    await iNodeMgr.transact(async (tran) => {
      const data = await iNodeMgr.get(tran, childIno);
      expect(data).toBeUndefined();
    });
  });
});
