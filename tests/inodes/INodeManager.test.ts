import os from 'os';
import pathNode from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { DB, errors as dbErrors } from '@matrixai/db';
import INodeManager from '@/inodes/INodeManager';
import * as utils from '@/utils';
import * as permissions from '@/permissions';

describe('INodeManager', () => {
  const logger = new Logger('INodeManager Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
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
      logger,
    });
    const rootIno = iNodeMgr.inoAllocate();
    const childIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(rootIno, childIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(rootIno);
        iNodeMgr.inoDeallocate(childIno);
      });
      await iNodeMgr.dirCreate(rootIno, {}, undefined, tran);
      await iNodeMgr.dirCreate(childIno, {}, rootIno, tran);
      await iNodeMgr.dirSetEntry(rootIno, 'childdir', childIno, tran);
    });
    await db.stop();
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
    iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    await iNodeMgr.withTransactionF(async (tran) => {
      const rootIno_ = await iNodeMgr.dirGetRoot(tran);
      expect(rootIno_).toBeDefined();
      expect(rootIno_).toBe(rootIno);
      const childIno_ = await iNodeMgr.dirGetEntry(rootIno, 'childdir', tran);
      expect(childIno_).toBeDefined();
      expect(childIno_).toBe(childIno);
    });
  });
  test('transactions are locked via inodes', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      logger,
    });
    // Demonstrate a counter increment race condition
    await iNodeMgr.withTransactionF(async (tran) => {
      await tran.put([...iNodeMgr.mgrDbPath, 'test'], 0);
    });
    await expect(
      Promise.all([
        iNodeMgr.withTransactionF(async (tran) => {
          const num = (await tran.get<number>([
            ...iNodeMgr.mgrDbPath,
            'test',
          ]))!;
          await tran.put([...iNodeMgr.mgrDbPath, 'test'], num + 1);
        }),
        iNodeMgr.withTransactionF(async (tran) => {
          const num = (await tran.get<number>([
            ...iNodeMgr.mgrDbPath,
            'test',
          ]))!;
          await tran.put([...iNodeMgr.mgrDbPath, 'test'], num + 1);
        }),
      ]),
    ).rejects.toThrow(dbErrors.ErrorDBTransactionConflict);
    await iNodeMgr.withTransactionF(async (tran) => {
      const num = (await tran.get<number>([...iNodeMgr.mgrDbPath, 'test']))!;
      // Race condition clobbers the counter
      expect(num).toBe(1);
    });
    // Now with proper locking, the race condition doesn't happen
    await iNodeMgr.withTransactionF(async (tran) => {
      await tran.put([...iNodeMgr.mgrDbPath, 'test'], 0);
    });
    const ino = iNodeMgr.inoAllocate();
    await Promise.all([
      iNodeMgr.withTransactionF(ino, async (tran) => {
        const num = (await tran.get<number>([...iNodeMgr.mgrDbPath, 'test']))!;
        await tran.put([...iNodeMgr.mgrDbPath, 'test'], num + 1);
      }),
      iNodeMgr.withTransactionF(ino, async (tran) => {
        const num = (await tran.get<number>([...iNodeMgr.mgrDbPath, 'test']))!;
        await tran.put([...iNodeMgr.mgrDbPath, 'test'], num + 1);
      }),
    ]);
    await iNodeMgr.withTransactionF(async (tran) => {
      const num = (await tran.get<number>([...iNodeMgr.mgrDbPath, 'test']))!;
      // Race condition is solved by the locking the ino
      expect(num).toBe(2);
    });
  });
  test('inodes can be scheduled for deletion when there are references to them', async () => {
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
    await iNodeMgr.withTransactionF(rootIno, childIno, async (tran) => {
      iNodeMgr.ref(childIno);
      await iNodeMgr.dirUnsetEntry(rootIno, 'childdir', tran);
    });
    await iNodeMgr.withTransactionF(async (tran) => {
      const data = await iNodeMgr.get(childIno, tran);
      expect(data).toBeDefined();
      expect(data!.gc).toBe(true);
      expect(data!.ino).toBe(childIno);
    });
    await iNodeMgr.withTransactionF(async (tran) => {
      await iNodeMgr.unref(childIno, tran);
    });
    await iNodeMgr.withTransactionF(async (tran) => {
      const data = await iNodeMgr.get(childIno, tran);
      expect(data).toBeUndefined();
    });
  });
});
