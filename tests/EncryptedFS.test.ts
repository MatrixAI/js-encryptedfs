import os from 'os';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import EncryptedFS from '@/EncryptedFS';
import * as utils from '@/utils';
import * as errors from '@/errors';

describe(EncryptedFS.name, () => {
  const logger = new Logger(`${EncryptedFS.name} Test`, LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const dbKey: Buffer = utils.generateKeySync(256);
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      utils.pathJoin(os.tmpdir(), 'encryptedfs-test-'),
    );
  });
  afterEach(async () => {
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test('efs readiness', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbPath: dataDir,
      dbKey,
      logger,
    });
    await expect(efs.destroy()).rejects.toThrow(errors.ErrorEncryptedFSRunning);
    // Should be a noop
    await efs.start();
    await efs.stop();
    await efs.destroy();
    await expect(efs.start()).rejects.toThrow(errors.ErrorEncryptedFSDestroyed);
    await expect(async () => {
      await efs.exists('.');
    }).rejects.toThrow(errors.ErrorEncryptedFSNotRunning);
    await expect(async () => {
      await efs.chdir('.');
    }).rejects.toThrow(errors.ErrorEncryptedFSNotRunning);
  });
  test('efs is persistent across restarts', async () => {
    const efs1 = await EncryptedFS.createEncryptedFS({
      dbPath: dataDir,
      dbKey,
      logger,
    });
    await efs1.writeFile('testfile', 'hello world');
    await efs1.stop();
    await efs1.start();
    expect(await efs1.readFile('testfile', { encoding: 'utf-8' })).toBe(
      'hello world',
    );
    await efs1.stop();
    const efs2 = await EncryptedFS.createEncryptedFS({
      dbPath: dataDir,
      dbKey,
      logger,
    });
    expect(await efs2.readFile('testfile', { encoding: 'utf-8' })).toBe(
      'hello world',
    );
    await efs2.stop();
  });
  test('creating fresh efs', async () => {
    const efs1 = await EncryptedFS.createEncryptedFS({
      dbPath: dataDir,
      dbKey,
      logger,
    });
    await efs1.writeFile('testfile', 'hello world');
    await efs1.stop();
    const efs2 = await EncryptedFS.createEncryptedFS({
      dbPath: dataDir,
      dbKey,
      logger,
      fresh: true,
    });
    await expect(efs2.readFile('testfile')).rejects.toThrow(
      errors.ErrorEncryptedFSError,
    );
    await efs2.stop();
  });
  test('efs exposes constants', async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbPath: dataDir,
      dbKey,
      logger,
    });
    expect(efs.constants.O_RDONLY).toBeDefined();
    expect(efs.constants.O_TRUNC).toBeDefined();
    expect(efs.constants.S_IRWXG).toBeDefined();
    await efs.stop();
  });
  test('validate key', async () => {
    let efs = await EncryptedFS.createEncryptedFS({
      dbPath: dataDir,
      dbKey,
      logger,
    });
    await efs.stop();
    const falseDbKey = await utils.generateKey(256);
    await expect(
      EncryptedFS.createEncryptedFS({
        dbPath: dataDir,
        dbKey: falseDbKey,
        logger,
      }),
    ).rejects.toThrow(errors.ErrorEncryptedFSKey);
    efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath: dataDir,
      logger,
    });
    await efs.stop();
  });
  test('iNode allocation across restarts', async () => {
    const d1 = 'dir1';
    const d1f1 = utils.pathJoin(d1, 'file1');
    const d1f2 = utils.pathJoin(d1, 'file2');
    const d1f3 = utils.pathJoin(d1, 'file3');
    const d2 = 'dir2';
    const d2f1 = utils.pathJoin(d2, 'file1');
    const d2f2 = utils.pathJoin(d2, 'file2');
    const d2f3 = utils.pathJoin(d2, 'file3');

    let efs = await EncryptedFS.createEncryptedFS({
      dbPath: dataDir,
      dbKey,
      logger,
    });

    const listNodes = async (efs) => {
      const iNodeManager = efs.iNodeMgr;
      const nodes: Array<number> = [];
      for await (const iNode of iNodeManager.getAll()) {
        nodes.push(iNode.ino);
      }
      return nodes;
    };

    await efs.mkdir(d1);
    await efs.writeFile(d1f1, d1f1);
    await efs.writeFile(d1f2, d1f2);
    await efs.writeFile(d1f3, d1f3);
    await efs.mkdir(d2);
    await efs.writeFile(d2f1, d2f1);
    await efs.writeFile(d2f2, d2f2);
    await efs.writeFile(d2f3, d2f3);
    // Inodes 1-9 allocated

    expect(await listNodes(efs)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    await efs.rmdir(d1, { recursive: true });
    // Inodes 1, 6-9 left
    expect(await listNodes(efs)).toEqual([1, 6, 7, 8, 9]);

    // Re-creating the efs
    await efs.stop();
    efs = await EncryptedFS.createEncryptedFS({
      dbPath: dataDir,
      dbKey,
      logger,
    });

    // Nodes should be maintained
    expect(await listNodes(efs)).toEqual([1, 6, 7, 8, 9]);

    // Creating new nodes.
    await efs.mkdir(d1);
    await efs.writeFile(d1f1, d1f1);
    await efs.writeFile(d1f2, d1f2);
    await efs.writeFile(d1f3, d1f3);

    // Expecting 3, 4, 5 and 10 to be created
    expect(await listNodes(efs)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Note that 2 is skipped, this seems to be incremented
    // but not created when the RFS is created
    await efs.stop();
  });
});
