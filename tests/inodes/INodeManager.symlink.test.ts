import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { DB } from '@matrixai/db';
import INodeManager from '@/inodes/INodeManager';
import * as utils from '@/utils';

describe('INodeManager Symlink', () => {
  const logger = new Logger('INodeManager Symlink Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'encryptedfs-test-'),
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
      logger,
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
  test('create and delete symlink', async () => {
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
    const symlinkIno = iNodeMgr.inoAllocate();
    await iNodeMgr.withTransactionF(rootIno, symlinkIno, async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(symlinkIno);
      });
      await iNodeMgr.symlinkCreate(symlinkIno, {}, 'a link', tran);
      await iNodeMgr.dirSetEntry(rootIno, 'somelink', symlinkIno, tran);
    });
    await iNodeMgr.withTransactionF(async (tran) => {
      expect(await iNodeMgr.symlinkGetLink(symlinkIno, tran)).toBe('a link');
      const statSymlink = await iNodeMgr.statGet(symlinkIno, tran);
      expect(statSymlink.isSymbolicLink()).toBe(true);
      expect(statSymlink['ino']).toBe(symlinkIno);
      expect(statSymlink['nlink']).toBe(1);
      const statDir = await iNodeMgr.statGet(rootIno, tran);
      expect(statDir['nlink']).toBe(2);
    });
    await iNodeMgr.withTransactionF(rootIno, symlinkIno, async (tran) => {
      await iNodeMgr.dirUnsetEntry(rootIno, 'somelink', tran);
    });
    await iNodeMgr.withTransactionF(async (tran) => {
      expect(await iNodeMgr.get(symlinkIno, tran)).toBeUndefined();
      const stat = await iNodeMgr.statGet(rootIno, tran);
      expect(stat['nlink']).toBe(2);
    });
  });
});
