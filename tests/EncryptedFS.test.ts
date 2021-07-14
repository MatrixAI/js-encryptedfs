import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import process from 'process';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import * as utils from '@/utils';
import EncryptedFS from '@/EncryptedFS';

describe('EncryptedFS', () => {
  const logger = new Logger('EncryptedFS Test', LogLevel.WARN, [new StreamHandler()]);
  const cwd = process.cwd();
  let dataDir: string;
  let key: Buffer;
  beforeEach(async () => {
    key = await utils.generateKey();
    dataDir = await fs.promises.mkdtemp(
      pathNode.join(os.tmpdir(), 'encryptedfs-test-'),
    );
  });
  afterEach(async () => {
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test('translating data paths at current directory', async () => {
    // efs started with lowerfs root at the current directory
    const efs = new EncryptedFS(key);

    expect(efs.getCwd()).toBe('/');

    // empty string is empty string
    expect(efs.translatePathData('')).toBe('');
    // upper root translates to the cwdLower
    expect(efs.translatePathData('/')).toBe(cwd);
    expect(efs.translatePathData('////')).toBe(cwd);
    expect(efs.translatePathData('/../')).toBe(cwd);
    expect(efs.translatePathData('../')).toBe(cwd);
    expect(efs.translatePathData('../../../')).toBe(cwd);
    // upper current directory is at cwd for lower
    expect(efs.translatePathData('.')).toBe(cwd);
    // files and directories and links
    expect(efs.translatePathData('/a')).toBe(
      pathNode.join(cwd, 'a.data')
    );
    expect(efs.translatePathData('/a///')).toBe(
      pathNode.join(cwd, 'a.data')
    );
    expect(efs.translatePathData('/a/b')).toBe(
      pathNode.join(cwd, 'a.data/b.data')
    );
    expect(efs.translatePathData('./a')).toBe(
      pathNode.join(cwd, 'a.data')
    );
    expect(efs.translatePathData('./a/b')).toBe(
      pathNode.join(cwd, 'a.data/b.data')
    );
    expect(efs.translatePathData('./a/../b')).toBe(
      pathNode.join(cwd, 'b.data')
    );
  });
  test('translating data paths at a directory', async () => {
    const efs = new EncryptedFS(key, fs, 'dir');


    // empty string is empty string
    expect(efs.translatePathData('')).toBe('');
    // upper root translates to the cwdLower
    expect(efs.translatePathData('/')).toBe(
      pathNode.join(cwd, 'dir')
    );
    expect(efs.translatePathData('////')).toBe(
      pathNode.join(cwd, 'dir')
    );
    expect(efs.translatePathData('/../')).toBe(
      pathNode.join(cwd, 'dir')
    );
    expect(efs.translatePathData('../')).toBe(
      pathNode.join(cwd, 'dir')
    );
    expect(efs.translatePathData('../../../')).toBe(
      pathNode.join(cwd, 'dir')
    );

  });
});
