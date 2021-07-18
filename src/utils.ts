import pathNode from 'path';
import {
  md,
  random,
  pkcs5,
  cipher,
  util as forgeUtil,
} from 'node-forge';

const ivSize = 16;
const authTagSize = 16;

const pathJoin = (pathNode.posix) ? pathNode.posix.join : pathNode.join;
const pathResolve = (pathNode.posix) ? pathNode.posix.resolve : pathNode.resolve;

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

async function generateKeyFromPass(
  password: string,
  salt?: string,
  bits: number = 256
): Promise<[Buffer, Buffer]> {
  if (salt == null) {
    salt = (await getRandomBytes(16)).toString('binary');
  }
  const keyLen = Math.floor(bits / 8);
  const key = await promisify<string>(pkcs5.pbkdf2)(
    password,
    salt,
    2048,
    keyLen,
    md.sha512.create()
  );
  return [Buffer.from(key, 'binary'), Buffer.from(salt, 'binary')];
}

function generateKeyFromPassSync(
  password: string,
  salt?: string,
  bits: number = 256
): [Buffer, Buffer] {
  if (salt == null) {
    salt = getRandomBytesSync(16).toString('binary');
  }
  const keyLen = Math.floor(bits / 8);
  const key = pkcs5.pbkdf2(
    password,
    salt,
    2048,
    keyLen,
    md.sha512.create()
  );
  return [Buffer.from(key, 'binary'), Buffer.from(salt, 'binary')];
}

function encryptWithKey(key: Buffer, plainText: Buffer): Buffer {
  const iv = getRandomBytesSync(ivSize);
  const c = cipher.createCipher('AES-GCM', key.toString('binary'));
  c.start({ iv: iv.toString('binary'), tagLength: authTagSize * 8 });
  c.update(forgeUtil.createBuffer(plainText));
  c.finish();
  const cipherText = Buffer.from(c.output.getBytes(), 'binary');
  const authTag = Buffer.from(c.mode.tag.getBytes(), 'binary');
  const data = Buffer.concat([iv, authTag, cipherText]);
  return data;
}

function decryptWithKey(key: Buffer, cipherText: Buffer): Buffer | undefined {
  if (cipherText.length <= 32) {
    return;
  }
  const iv = cipherText.subarray(0, ivSize);
  const authTag = cipherText.subarray(ivSize, ivSize + authTagSize);
  const cipherText_ = cipherText.subarray(ivSize + authTagSize);
  const d = cipher.createDecipher('AES-GCM', key.toString('binary'));
  d.start({
    iv: iv.toString('binary'),
    tagLength: authTagSize * 8,
    tag: forgeUtil.createBuffer(authTag),
  });
  d.update(forgeUtil.createBuffer(cipherText_));
  if (!d.finish()) {
    return;
  }
  return Buffer.from(d.output.getBytes(), 'binary');
}

/**
 * Maps the plaintext position to the block index
 */
function blockIndexStart(blockSize: number, bytePosition: number): number {
  return Math.floor(bytePosition / blockSize);
}

/**
 * Calculates last block index
 */
function blockIndexEnd(blockIndexStart: number, blockLength: number): number {
  return blockIndexStart + blockLength - 1;
}

/**
 * Maps the plaintest position to the offset from the target block
 */
function blockOffset(blockSize: number, bytePosition: number): number {
  return bytePosition % blockSize;
}

/**
 * Calculates how many blocks need to be written using
 * the block offset and the plaintext byte length
 */
function blockLength(blockSize: number, blockOffset: number, byteLength: number): number {
  return Math.ceil((blockOffset + byteLength) / blockSize);
}

function *range(start: number, stop?: number, step = 1): Generator<number> {
  if (stop == null) {
    stop = start;
    start = 0;
  }
  for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
    yield i;
  }
}


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

function promise<T>(): {
  p: Promise<T>;
  resolveP: (value: T | PromiseLike<T>) => void;
  rejectP: (reason?: any) => void;
} {
  let resolveP, rejectP;
  const p = new Promise<T>((resolve, reject) => {
    resolveP = resolve;
    rejectP = reject;
  });
  return {
    p,
    resolveP,
    rejectP,
  };
}

export {
  ivSize,
  authTagSize,
  pathJoin,
  pathResolve,
  encryptWithKey,
  decryptWithKey,
  generateKey,
  generateKeySync,
  generateKeyFromPass,
  generateKeyFromPassSync,
  getRandomBytes,
  getRandomBytesSync,
  promisify,
  promise,
  blockIndexStart,
  blockIndexEnd,
  blockOffset,
  blockLength,
  range,
  // resolvePath,
  // getDirsRecursive,
  // getPathToMeta,
  // getBlocksToWrite,
  // compareBlockArrays,
};
