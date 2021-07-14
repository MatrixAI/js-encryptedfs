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
  test('translating paths at current directory', async () => {
    // efs started with lowerfs root at the current directory
    const efs = new EncryptedFS(key);
    expect(efs.getCwd()).toBe('/');
    expect(efs.cwdLower).toBe(cwd);
    // empty string is empty string
    expect(efs.translatePath('')).toEqual(['', '']);
    // upper root translates to the cwdLower
    expect(efs.translatePath('/')).toEqual([cwd, cwd]);
    expect(efs.translatePath('////')).toEqual([cwd, cwd]);
    expect(efs.translatePath('/../')).toEqual([cwd, cwd]);
    expect(efs.translatePath('../')).toEqual([cwd, cwd]);
    expect(efs.translatePath('../../../')).toEqual([cwd, cwd]);
    // upper current directory is at cwd for lower
    expect(efs.translatePath('.')).toEqual([cwd, cwd]);
    // files and directories and links
    expect(efs.translatePath('/a')).toEqual(
      [
        pathNode.posix.join(cwd, 'a.data'),
        pathNode.posix.join(cwd, '.a.meta')
      ]
    );
    expect(efs.translatePath('/a///')).toEqual(
      [
        pathNode.posix.join(cwd, 'a.data'),
        pathNode.posix.join(cwd, '.a.meta'),
      ]
    );
    expect(efs.translatePath('/a/b')).toEqual(
      [
        pathNode.posix.join(cwd, 'a.data/b.data'),
        pathNode.posix.join(cwd, 'a.data/.b.meta')
      ]
    );
    expect(efs.translatePath('./a')).toEqual(
      [
        pathNode.posix.join(cwd, 'a.data'),
        pathNode.posix.join(cwd, '.a.meta'),
      ]
    );
    expect(efs.translatePath('./a/b')).toEqual(
      [
        pathNode.posix.join(cwd, 'a.data/b.data'),
        pathNode.posix.join(cwd, 'a.data/.b.meta'),
      ]
    );
    expect(efs.translatePath('./a/../b')).toEqual(
      [
        pathNode.posix.join(cwd, 'b.data'),
        pathNode.posix.join(cwd, '.b.meta')
      ]
    );
  });
  test('translating data paths at a directory', async () => {
    const efs = new EncryptedFS(key, fs, 'dir');
    expect(efs.getCwd()).toBe('/');
    expect(efs.cwdLower).toBe(pathNode.posix.join(cwd, 'dir'));
    // empty string is empty string
    expect(efs.translatePathData('')).toBe('');
    // upper root translates to the cwdLower
    expect(efs.translatePathData('/')).toBe(
      pathNode.posix.join(cwd, 'dir')
    );
    expect(efs.translatePathData('////')).toBe(
      pathNode.posix.join(cwd, 'dir')
    );
    expect(efs.translatePathData('/../')).toBe(
      pathNode.posix.join(cwd, 'dir')
    );
    expect(efs.translatePathData('../')).toBe(
      pathNode.posix.join(cwd, 'dir')
    );
    expect(efs.translatePathData('../../../')).toBe(
      pathNode.posix.join(cwd, 'dir')
    );
    // upper current directory is at cwd for lower
    expect(efs.translatePathData('.')).toBe(
      pathNode.posix.join(cwd, 'dir')
    );
    // files and directories and links
    expect(efs.translatePathData('/a')).toBe(
      pathNode.posix.join(cwd, 'dir/a.data')
    );
    expect(efs.translatePathData('/a///')).toBe(
      pathNode.posix.join(cwd, 'dir/a.data')
    );
    expect(efs.translatePathData('/a/b')).toBe(
      pathNode.posix.join(cwd, 'dir/a.data/b.data')
    );
    expect(efs.translatePathData('./a')).toBe(
      pathNode.posix.join(cwd, 'dir/a.data')
    );
    expect(efs.translatePathData('./a/b')).toBe(
      pathNode.posix.join(cwd, 'dir/a.data/b.data')
    );
    expect(efs.translatePathData('./a/../b')).toBe(
      pathNode.posix.join(cwd, 'dir/b.data')
    );
  });
  test('translating data paths at root', async () => {
    const efs = new EncryptedFS(key, fs, dataDir);
    expect(efs.getCwd()).toBe('/');
    expect(efs.cwdLower).toBe(dataDir);
    // empty string is empty string
    expect(efs.translatePathData('')).toBe('');
    // upper root translates to the cwdLower
    expect(efs.translatePathData('/')).toBe(dataDir);
    expect(efs.translatePathData('////')).toBe(dataDir);
    expect(efs.translatePathData('/../')).toBe(dataDir);
    expect(efs.translatePathData('../')).toBe(dataDir);
    expect(efs.translatePathData('../../../')).toBe(dataDir);
    // upper current directory is at cwd for lower
    expect(efs.translatePathData('.')).toBe(dataDir);
    // files and directories and links
    expect(efs.translatePathData('/a')).toBe(
      pathNode.posix.join(dataDir, 'a.data')
    );
    expect(efs.translatePathData('/a///')).toBe(
      pathNode.posix.join(dataDir, 'a.data')
    );
    expect(efs.translatePathData('/a/b')).toBe(
      pathNode.posix.join(dataDir, 'a.data/b.data')
    );
    expect(efs.translatePathData('./a')).toBe(
      pathNode.posix.join(dataDir, 'a.data')
    );
    expect(efs.translatePathData('./a/b')).toBe(
      pathNode.posix.join(dataDir, 'a.data/b.data')
    );
    expect(efs.translatePathData('./a/../b')).toBe(
      pathNode.posix.join(dataDir, 'b.data')
    );
  });
  test('translating data paths at up one directory', async () => {
    const upDir = pathNode.posix.resolve('..');
    const efs = new EncryptedFS(key, fs, '..');
    expect(efs.getCwd()).toBe('/');
    expect(efs.cwdLower).toBe(upDir);
    // empty string is empty string
    expect(efs.translatePathData('')).toBe('');
    // upper root translates to the cwdLower
    expect(efs.translatePathData('/')).toBe(upDir);
    expect(efs.translatePathData('////')).toBe(upDir);
    expect(efs.translatePathData('/../')).toBe(upDir);
    expect(efs.translatePathData('../')).toBe(upDir);
    expect(efs.translatePathData('../../../')).toBe(upDir);
    // upper current directory is at cwd for lower
    expect(efs.translatePathData('.')).toBe(upDir);
    // files and directories and links
    expect(efs.translatePathData('/a')).toBe(
      pathNode.posix.join(upDir, 'a.data')
    );
    expect(efs.translatePathData('/a///')).toBe(
      pathNode.posix.join(upDir, 'a.data')
    );
    expect(efs.translatePathData('/a/b')).toBe(
      pathNode.posix.join(upDir, 'a.data/b.data')
    );
    expect(efs.translatePathData('./a')).toBe(
      pathNode.posix.join(upDir, 'a.data')
    );
    expect(efs.translatePathData('./a/b')).toBe(
      pathNode.posix.join(upDir, 'a.data/b.data')
    );
    expect(efs.translatePathData('./a/../b')).toBe(
      pathNode.posix.join(upDir, 'b.data')
    );
  });
});
