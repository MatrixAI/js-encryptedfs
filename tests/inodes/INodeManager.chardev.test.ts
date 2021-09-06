import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import * as utils from '@/utils';

describe('INodeManager CharacterDev', () => {
  const logger = new Logger('INodeManager CharacterDev Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const devMgr = new vfs.DeviceManager();
  // register the devices
  devMgr.registerChr(vfs.nullDev, 1, 3);
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
  test('create and delete character device', async () => {
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
    const charDevIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(
      async (tran) => {
        tran.queueFailure(() => {
          iNodeMgr.inoDeallocate(charDevIno);
        });
        await iNodeMgr.charDevCreate(tran, charDevIno, {
          rdev: vfs.mkDev(1, 3),
        });
        await iNodeMgr.dirSetEntry(tran, rootIno, 'chardev', charDevIno);
      },
      [rootIno, charDevIno],
    );
    await iNodeMgr.transact(async (tran) => {
      const nullDev = await iNodeMgr.charDevGetFileDesOps(tran, charDevIno);
      expect(nullDev).toBeDefined();
      expect(nullDev).toBe(vfs.nullDev);
      const statCharDev = await iNodeMgr.statGet(tran, charDevIno);
      expect(statCharDev.isCharacterDevice()).toBe(true);
      expect(statCharDev['ino']).toBe(charDevIno);
      expect(statCharDev['nlink']).toBe(1);
      const statDir = await iNodeMgr.statGet(tran, rootIno);
      expect(statDir['nlink']).toBe(2);
    });
    await iNodeMgr.transact(
      async (tran) => {
        await iNodeMgr.dirUnsetEntry(tran, rootIno, 'chardev');
      },
      [rootIno, charDevIno],
    );
    await iNodeMgr.transact(async (tran) => {
      expect(await iNodeMgr.get(tran, charDevIno)).toBeUndefined();
      const stat = await iNodeMgr.statGet(tran, rootIno);
      expect(stat['nlink']).toBe(2);
    });
  });
});
