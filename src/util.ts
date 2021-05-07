import type { PathLike } from 'fs';
import { pbkdf2, random } from 'node-forge';
import pathNode from 'path';

enum EncryptedFSLayers {
  upper = 'upper',
  lower = 'lower',
}

const cryptoConstants = Object.freeze({
  SALT_LEN: 64,
  INIT_VECTOR_LEN: 16,
  AUTH_TAG_LEN: 16,
  KEY_LEN: 16,
  PBKDF_NUM_ITERATIONS: 9816,
});

function generateMasterKey(password: string): Buffer {
  const salt = getRandomBytesSync(cryptoConstants.SALT_LEN);
  return pbkdf2(
    Buffer.from(password),
    salt,
    cryptoConstants.PBKDF_NUM_ITERATIONS,
    cryptoConstants.KEY_LEN,
    'sha512',
  );
}

function getRandomBytesSync(size: number): Buffer {
  return Buffer.from(random.getBytesSync(size), 'binary');
}

function promisify<T>(f): (...args: any[]) => Promise<T> {
  return function <T>(...args): Promise<T> {
    return new Promise((resolve, reject) => {
      const callback = (error, ...values) => {
        if (error) {
          return reject(error);
        }
        return resolve(values.length === 1 ? values[0] : values);
      };
      args.push(callback);
      f.apply(this, args);
    });
  };
}

function addSuffix(path: PathLike): string {
  const _path = pathNode.normalize(path.toString());
  const dirs = _path.split(pathNode.sep);
  let navPath = '';
  for (const dir of dirs) {
    if (dir != '.' && dir != '' && dir != '..') {
      navPath = pathNode.join(navPath, `${dir}.data`);
    }
  }
  return navPath;
}

function resolvePath(path: PathLike): string {
  const _path = path.toString();
  let addition = '';
  if (_path.substring(_path.length - 1) === '/') {
    addition = '/';
  } else if (_path.substring(_path.length - 2) === '/.') {
    addition = '/.';
  }
  return addition;
}

function getDirsRecursive(path: string): string[] {
  const _path = pathNode.normalize(path);
  const dirs = _path.split(pathNode.sep);
  const navPath: string[] = [];
  for (const dir of dirs) {
    if (dir != '.' && dir != '' && dir != '..') {
      navPath.push(dir);
    }
  }
  return navPath;
}

function getPathToMeta(path: PathLike): string {
  const _path = path.toString();
  const dir = addSuffix(pathNode.dirname(_path));
  const base = pathNode.basename(_path);
  return pathNode.join(dir, `.${base}.meta`);
}

function getBlocksToWrite(
  position: number,
  length: number,
  blockSize: number,
): Array<number> {
  const startBlock = Math.floor(position / blockSize);
  const endBlock = Math.floor((position + length - 1) / blockSize);
  let counter = startBlock;
  const blocks: Array<number> = [];
  while (counter <= endBlock) {
    blocks.push(counter);
    counter++;
  }
  return blocks;
}

function compareBlockArrays(
  blockA: Array<number>,
  blockB: Array<number>,
): boolean {
  let check = true;
  if (!blockB) {
    return false;
  }
  for (const index in blockA) {
    if (!blockB.includes(blockA[index])) {
      check = false;
    }
  }
  return check;
}

export {
  EncryptedFSLayers,
  cryptoConstants,
  generateMasterKey,
  getRandomBytesSync,
  promisify,
  addSuffix,
  resolvePath,
  getDirsRecursive,
  getPathToMeta,
  getBlocksToWrite,
  compareBlockArrays,
};
