import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import EncryptedFS from '@/EncryptedFS';
import * as utils from '@/utils';
import * as errors from '@/errors';

describe('EncryptedFS', () => {
  const logger = new Logger('EncryptedFS Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const dbKey: Buffer = utils.generateKeySync(256);
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'encryptedfs-test-'),
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
});
