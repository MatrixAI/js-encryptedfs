import type { Callback } from './types';
import type { Stat } from '.';

import pathNode from 'path';
import { md, random, pkcs5, cipher, util as forgeUtil } from 'node-forge';
import callbackify from 'util-callbackify';

import { constants, devices as deviceConstants } from './constants';

const ivSize = 16;
const authTagSize = 16;

const pathJoin = pathNode.posix ? pathNode.posix.join : pathNode.join;
const pathResolve = pathNode.posix ? pathNode.posix.resolve : pathNode.resolve;

/**
 * Slice-copies the Node Buffer to a new ArrayBuffer
 */
function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/**
 * Wraps ArrayBuffer in Node Buffer with zero copy
 */
function fromArrayBuffer(
  b: ArrayBuffer,
  offset?: number,
  length?: number,
): Buffer {
  return Buffer.from(b, offset, length);
}

async function getRandomBytes(size: number): Promise<Buffer> {
  return Buffer.from(await random.getBytes(size), 'binary');
}

function getRandomBytesSync(size: number): Buffer {
  return Buffer.from(random.getBytesSync(size), 'binary');
}

async function generateKey(bits: 128 | 192 | 256 = 256): Promise<Buffer> {
  if (![128, 192, 256].includes(bits)) {
    throw new RangeError('AES only allows 128, 192, 256 bit sizes');
  }
  const len = Math.floor(bits / 8);
  const key = await getRandomBytes(len);
  return key;
}

function generateKeySync(bits: 128 | 192 | 256 = 256): Buffer {
  if (![128, 192, 256].includes(bits)) {
    throw new RangeError('AES only allows 128, 192, 256 bit sizes');
  }
  const len = Math.floor(bits / 8);
  const key = getRandomBytesSync(len);
  return key;
}

async function generateKeyFromPass(
  password: string,
  salt?: string,
  bits: 128 | 192 | 256 = 256,
): Promise<[Buffer, Buffer]> {
  if (![128, 192, 256].includes(bits)) {
    throw new RangeError('AES only allows 128, 192, 256 bit sizes');
  }
  if (salt == null) {
    salt = (await getRandomBytes(16)).toString('binary');
  }
  const keyLen = Math.floor(bits / 8);
  const key = await promisify<string>(pkcs5.pbkdf2)(
    password,
    salt,
    2048,
    keyLen,
    md.sha512.create(),
  );
  return [Buffer.from(key, 'binary'), Buffer.from(salt, 'binary')];
}

function generateKeyFromPassSync(
  password: string,
  salt?: string,
  bits: 128 | 192 | 256 = 256,
): [Buffer, Buffer] {
  if (![128, 192, 256].includes(bits)) {
    throw new RangeError('AES only allows 128, 192, 256 bit sizes');
  }
  if (salt == null) {
    salt = getRandomBytesSync(16).toString('binary');
  }
  const keyLen = Math.floor(bits / 8);
  const key = pkcs5.pbkdf2(password, salt, 2048, keyLen, md.sha512.create());
  return [Buffer.from(key, 'binary'), Buffer.from(salt, 'binary')];
}

// ATTEMPT TO DO THIS WITH ARRAYBUFFER
// Use ByteBuffer instead

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
 * Calculates the byte position start from block size and block index
 */
function blockPositionStart(blockSize: number, blockIndex: number): number {
  return blockSize * blockIndex;
}

/**
 * Calculates the byte position end from block size and block index
 */
function blockPositionEnd(blockSize: number, blockIndex: number): number {
  return blockSize * blockIndex + blockSize - 1;
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
function blockLength(
  blockSize: number,
  blockOffset: number,
  byteLength: number,
): number {
  return Math.ceil((blockOffset + byteLength) / blockSize);
}

function* range(start: number, stop?: number, step = 1): Generator<number> {
  if (stop == null) {
    stop = start;
    start = 0;
  }
  for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
    yield i;
  }
}

function blockRanges(
  blockLoaded: Set<number>,
  blockIndexStart: number,
  blockIndexEnd: number,
): Array<[number, number]> {
  const blockRanges: Array<[number, number]> = [];
  let blockRangeStart: number | null = null;
  let blockRangeEnd: number | null = null;
  for (const blockIndex of range(blockIndexStart, blockIndexEnd + 1)) {
    if (!blockLoaded.has(blockIndex) && blockRangeStart == null) {
      // If the range isn't started, start the range
      blockRangeStart = blockIndex;
      blockRangeEnd = blockIndex;
    } else if (!blockLoaded.has(blockIndex) && blockRangeStart != null) {
      // If the range is started, update the end
      blockRangeEnd = blockIndex;
    } else if (
      blockLoaded.has(blockIndex) &&
      blockRangeStart != null &&
      blockRangeEnd != null
    ) {
      // Push a completed segment and reset the start and end
      blockRanges.push([blockRangeStart, blockRangeEnd]);
      blockRangeStart = null;
      blockRangeEnd = null;
    }
  }
  // Push in the last segment if it is set
  if (blockRangeStart != null && blockRangeEnd != null) {
    blockRanges.push([blockRangeStart, blockRangeEnd]);
  }
  return blockRanges;
}

function segmentBuffer(blockSize: number, buffer: Buffer): Array<Buffer> {
  let bufferPos = 0;
  const bufferArray: Buffer[] = [];
  while (bufferPos < buffer.length) {
    bufferArray.push(buffer.slice(bufferPos, bufferPos + blockSize));
    bufferPos += blockSize;
  }
  return bufferArray;
}

function parseOpenFlags(flags: string): number {
  let flags_;
  switch (flags) {
    case 'r':
    case 'rs':
      flags_ = constants.O_RDONLY;
      break;
    case 'r+':
    case 'rs+':
      flags_ = constants.O_RDWR;
      break;
    case 'w':
      flags_ = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC;
      break;
    case 'wx':
      flags_ =
        constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_EXCL;
      break;
    case 'w+':
      flags_ = constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC;
      break;
    case 'wx+':
      flags_ =
        constants.O_RDWR |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_EXCL;
      break;
    case 'a':
      flags_ = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT;
      break;
    case 'ax':
      flags_ =
        constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_EXCL;
      break;
    case 'a+':
      flags_ = constants.O_RDWR | constants.O_APPEND | constants.O_CREAT;
      break;
    case 'ax+':
      flags_ =
        constants.O_RDWR |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_EXCL;
      break;
    default:
      throw new TypeError('Unknown file open flag: ' + flags);
  }
  return flags_;
}

/**
 * Applies umask to default set of permissions.
 */
function applyUmask(perms: number, umask: number): number {
  return perms & ~umask;
}

/**
 * Checks the desired permissions with user id and group id against the metadata of an iNode.
 * The desired permissions can be bitwise combinations of constants.R_OK, constants.W_OK and constants.X_OK.
 */
function checkPermissions(
  access: number,
  uid: number,
  gid: number,
  stat: Stat,
): boolean {
  return (access & resolveOwnership(uid, gid, stat)) === access;
}

/**
 * Permission checking relies on ownership details of the iNode.
 * If the accessing user is the same as the iNode user, then only user permissions are used.
 * If the accessing group is the same as the iNode group, then only the group permissions are used.
 * Otherwise the other permissions are used.
 */
function resolveOwnership(uid: number, gid: number, stat: Stat): number {
  if (uid === stat.uid) {
    return (stat.mode & constants.S_IRWXU) >> 6;
  } else if (gid === stat.gid) {
    return (stat.mode & constants.S_IRWXG) >> 3;
  } else {
    return stat.mode & constants.S_IRWXO;
  }
}

function mkDev(major: number, minor: number): number {
  return (major << deviceConstants.MINOR_BITSIZE) | minor;
}

function unmkDev(dev: number): [number, number] {
  const major = dev >> deviceConstants.MINOR_BITSIZE;
  const minor = dev & ((1 << deviceConstants.MINOR_BITSIZE) - 1);
  return [major, minor];
}

// These 2 functions should go into the
// workers as well, as this means multiple blocks are being decrypted at once
// function plainToCipherSegment(
//   key: Buffer,
//   plainSegment: Buffer,
//   blockLength: number,
//   blockSizePlain: number,
//   blockSizeCipher: number,
// ): Buffer {
//   const cipherSegment = Buffer.allocUnsafe(
//     blockLength * blockSizeCipher
//   );
//   for (
//     let i = 0, j = i * blockSizePlain;
//     i < blockLength;
//     ++i
//   ) {
//     const plainBlock = plainSegment.slice(
//       j,
//       j + this.blockSizePlain
//     );
//     const cipherBlock = encryptWithKey(key, plainBlock);
//     cipherBlock.copy(cipherSegment, i * blockSizeCipher);
//   }
//   return cipherSegment;
// }

// function cipherToPlainSegment(
//   key: Buffer,
//   cipherSegment: Buffer,
//   blockLength: number,
//   blockSizePlain: number,
//   blockSizeCipher: number,
// ): Buffer | undefined {
//   const plainSegment = Buffer.allocUnsafe(
//     blockLength * blockSizePlain
//   );
//   for (
//     let i = 0, j = i * blockSizeCipher;
//     i < blockLength;
//     ++i
//   ) {
//     const cipherBlock = cipherSegment.slice(
//       j,
//       j + blockSizeCipher
//     );
//     const plainBlock = decryptWithKey(key, cipherBlock);
//     if (plainBlock == null) {
//       return;
//     }
//     plainBlock.copy(plainSegment, i * blockSizePlain);
//   }
//   return plainSegment;
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

/**
 * Equivalent of Promise.all but for promises
 */
function callbackAll(
  calls: Array<(c: Callback<Array<any>>) => any>,
  callback: Callback<[Array<any>]>,
): void {
  let resolved = 0;
  const results: Array<any> = [];
  for (const [i, call] of calls.entries()) {
    call((e, ...result) => {
      if (e != null) {
        callback(e);
        return;
      }
      resolved++;
      results[i] = result;
      if (resolved === calls.length) {
        callback(null, results);
        return;
      }
      return;
    });
  }
}

async function maybeCallback<T>(
  f: () => Promise<T>,
  callback?: Callback<[T]>,
): Promise<T | void> {
  if (callback == null) {
    return await f();
  } else {
    callbackify(f)(callback);
    return;
  }
}

export {
  ivSize,
  authTagSize,
  pathJoin,
  pathResolve,
  toArrayBuffer,
  fromArrayBuffer,
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
  blockPositionStart,
  blockPositionEnd,
  blockOffset,
  blockLength,
  blockRanges,
  range,
  segmentBuffer,
  parseOpenFlags,
  applyUmask,
  checkPermissions,
  mkDev,
  unmkDev,
  // PlainToCipherSegment,
  // cipherToPlainSegment,
  callbackAll,
  maybeCallback,
};
