import pathNode from 'path';
import {
  md,
  random,
  pkcs5
} from 'node-forge';

const cryptoConstants = Object.freeze({
  SALT_LEN: 16,
  INIT_VECTOR_LEN: 16,
  AUTH_TAG_LEN: 16,
  KEY_LEN: 32,
  PBKDF_NUM_ITERATIONS: 2048,
});

const pathJoin = (pathNode.posix) ? pathNode.posix.join : pathNode.join;

async function getRandomBytes(size: number): Promise<Buffer> {
  return Buffer.from(await random.getBytes(size), 'binary');
}

function getRandomBytesSync(size: number): Buffer {
  return Buffer.from(random.getBytesSync(size), 'binary');
}

async function generateKey(bits: number = 256): Promise<Buffer> {
  const len = Math.floor(bits / 8);
  const key = await getRandomBytes(len);
  return key;
}

function generateKeySync(bits: number = 256): Buffer {
  const len = Math.floor(bits / 8);
  const key = getRandomBytesSync(len);
  return key;
}

async function generateKeyFromPass(password: string, salt?: string): Promise<[Buffer, Buffer]> {
  if (salt == null) {
    salt = (await getRandomBytes(cryptoConstants.SALT_LEN)).toString('binary');
  }
  const key = await promisify<string>(pkcs5.pbkdf2)(
    password,
    salt,
    cryptoConstants.PBKDF_NUM_ITERATIONS,
    cryptoConstants.KEY_LEN,
    md.sha512.create()
  );
  return [Buffer.from(key, 'binary'), Buffer.from(salt, 'binary')];
}

function generateKeyFromPassSync(password: string, salt?: string): [Buffer, Buffer] {
  if (salt == null) {
    salt = getRandomBytesSync(cryptoConstants.SALT_LEN).toString('binary');
  }
  const key = pkcs5.pbkdf2(
    password,
    salt,
    cryptoConstants.PBKDF_NUM_ITERATIONS,
    cryptoConstants.KEY_LEN,
    md.sha512.create()
  );
  return [Buffer.from(key, 'binary'), Buffer.from(salt, 'binary')];
}

function translatePath(pathUpper: string): [string, string] {
  const pathUpper_ = pathNode.normalize(pathUpper);
  const partsUpper = pathUpper_.split('/')
  if (!partsUpper.length) {
    return ['', ''];
  }
  const partsUpperLast = partsUpper.pop();
  const partsLower = partsUpper.map((p) => {
    if (p == '') {
      return '/';
    }
    return p + '.data';
  });
  const pathData = pathJoin(
    ...partsLower,
    `${partsUpperLast}.data`
  );
  const pathMeta = pathJoin(
    ...partsLower,
    `.${partsUpperLast}.meta`
  );
  return [pathData, pathMeta];
}

function translatePathData(pathUpper: string): string {
  const pathUpper_ = pathNode.normalize(pathUpper);
  const partsUpper = pathUpper_.split('/')
  if (!partsUpper.length) {
    return '';
  }
  const partsLower = partsUpper.map((p) => {
    if (p == '') {
      return '/';
    }
    return p + '.data';
  });
  return pathNode.join(...partsLower);
}

function translatePathMeta(pathUpper: string): string {
  const pathUpper_ = pathNode.normalize(pathUpper);
  const partsUpper = pathUpper_.split('/')
  if (!partsUpper.length) {
    return '';
  }
  const partsUpperLast = partsUpper.pop();
  const partsLower = partsUpper.map((p) => {
    if (p == '') {
      return '/';
    }
    return p + '.data';
  });
  return pathNode.join(
    ...partsLower,
    `.${partsUpperLast}.meta`
  );
}

// function resolvePath(path: PathLike): string {
//   const _path = path.toString();
//   let addition = '';
//   if (_path.substring(_path.length - 1) === '/') {
//     addition = '/';
//   } else if (_path.substring(_path.length - 2) === '/.') {
//     addition = '/.';
//   }
//   return addition;
// }

// function getDirsRecursive(path: string): string[] {
//   const _path = pathNode.normalize(path);
//   const dirs = _path.split(pathNode.sep);
//   const navPath: string[] = [];
//   for (const dir of dirs) {
//     if (dir != '.' && dir != '' && dir != '..') {
//       navPath.push(dir);
//     }
//   }
//   return navPath;
// }

// function getBlocksToWrite(
//   position: number,
//   length: number,
//   blockSize: number,
// ): Array<number> {
//   const startBlock = Math.floor(position / blockSize);
//   const endBlock = Math.floor((position + length - 1) / blockSize);
//   let counter = startBlock;
//   const blocks: Array<number> = [];
//   while (counter <= endBlock) {
//     blocks.push(counter);
//     counter++;
//   }
//   return blocks;
// }

// function compareBlockArrays(
//   blockA: Array<number>,
//   blockB: Array<number>,
// ): boolean {
//   let check = true;
//   if (!blockB) {
//     return false;
//   }
//   for (const index in blockA) {
//     if (!blockB.includes(blockA[index])) {
//       check = false;
//     }
//   }
//   return check;
// }

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

export {
  cryptoConstants,
  pathJoin,
  translatePath,
  translatePathData,
  translatePathMeta,
  generateKey,
  generateKeySync,
  generateKeyFromPass,
  generateKeyFromPassSync,
  getRandomBytes,
  getRandomBytesSync,
  promisify,
  // resolvePath,
  // getDirsRecursive,
  // getPathToMeta,
  // getBlocksToWrite,
  // compareBlockArrays,
};
