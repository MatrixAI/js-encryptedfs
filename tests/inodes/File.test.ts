import type { DBLevel, DBOp } from '@/db/types';

import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from '@/db';
import { INodeManager, File } from '@/inodes';
import * as utils from '@/utils';
import { Mutex } from 'async-mutex';

describe('File INode', () => {
  const logger = new Logger('File INode Test', LogLevel.WARN, [new StreamHandler()]);
  const devMgr = new vfs.DeviceManager();
  let dataDir: string;
  let db: DB;
  let dbKey: Buffer = utils.generateKeySync(256);
  const lock = new Mutex;
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    db = new DB({
      dbKey,
      dbPath: `${dataDir}/db`,
      logger
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
  test('create a file INode', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const data = Buffer.from('File INode Creation');
    const iNode = await File.createFile({
      params: {
        ino: 1,
        mode: vfs.DEFAULT_FILE_PERM,
        uid: vfs.DEFAULT_ROOT_UID,
        gid: vfs.DEFAULT_ROOT_GID,
      },
      iNodeMgr: iNodeMgr,
      lock,
      data: data,
    });
    expect(iNode).toBeInstanceOf(File);
  });
  test('access data in file iNode', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
    const data = Buffer.from('File INode Creation');
    const iNode = await File.createFile({
      params: {
        ino: 1,
        mode: vfs.DEFAULT_FILE_PERM,
        uid: vfs.DEFAULT_ROOT_UID,
        gid: vfs.DEFAULT_ROOT_GID,
      },
      iNodeMgr: iNodeMgr,
      lock,
      data: data,
    });
    for await (const block of iNode.getBlocks(1, 4)) {
      console.log(data);
    }
  });
});
