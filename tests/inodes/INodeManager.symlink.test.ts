import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import * as utils from '@/utils';

describe('INodeManager Symlink', () => {
  const logger = new Logger('INodeManager Symlink Test', LogLevel.WARN, [
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
      devMgr,
      logger,
    });
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(
      async (tran) => {
        tran.queueFailure(() => {
          iNodeMgr.inoDeallocate(rootIno);
        });
        await iNodeMgr.dirCreate(tran, rootIno, {});
      },
      [rootIno],
    );
    const symlinkIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(
      async (tran) => {
        tran.queueFailure(() => {
          iNodeMgr.inoDeallocate(symlinkIno);
        });
        await iNodeMgr.symlinkCreate(tran, symlinkIno, {}, 'a link');
        await iNodeMgr.dirSetEntry(tran, rootIno, 'somelink', symlinkIno);
      },
      [rootIno, symlinkIno],
    );
    await iNodeMgr.transact(async (tran) => {
      expect(await iNodeMgr.symlinkGetLink(tran, symlinkIno)).toBe('a link');
      const statSymlink = await iNodeMgr.statGet(tran, symlinkIno);
      expect(statSymlink.isSymbolicLink()).toBe(true);
      expect(statSymlink['ino']).toBe(symlinkIno);
      expect(statSymlink['nlink']).toBe(1);
      const statDir = await iNodeMgr.statGet(tran, rootIno);
      expect(statDir['nlink']).toBe(2);
    });
    await iNodeMgr.transact(
      async (tran) => {
        await iNodeMgr.dirUnsetEntry(tran, rootIno, 'somelink');
      },
      [rootIno, symlinkIno],
    );
    await iNodeMgr.transact(async (tran) => {
      expect(await iNodeMgr.get(tran, symlinkIno)).toBeUndefined();
      const stat = await iNodeMgr.statGet(tran, rootIno);
      expect(stat['nlink']).toBe(2);
    });
  });
});
