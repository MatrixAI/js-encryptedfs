import type { Callback } from '@/types';
import * as utils from '@/utils';
import { maybeCallback } from '@/utils';

describe('utils', () => {
  let key: Buffer;
  beforeAll(async () => {
    key = await utils.generateKey();
  });
  test('random bytes generation', async () => {
    const buf1 = await utils.getRandomBytes(1);
    expect(buf1.length).toBe(1);
    const buf2 = utils.getRandomBytesSync(100);
    expect(buf2.length).toBe(100);
    const buf3 = utils.getRandomBytesSync(1000);
    expect(buf3.length).toBe(1000);
  });
  test('key is randomly generated', async () => {
    const key1 = await utils.generateKey();
    const key2 = await utils.generateKey();
    expect(key1.equals(key2)).toBe(false);
  });
  test('key generation from password is non-deterministic with random salt', async () => {
    const [key1, salt1] = await utils.generateKeyFromPass('somepassword');
    const [key2, salt2] = await utils.generateKeyFromPass('somepassword');
    expect(key1.equals(key2)).toBe(false);
    expect(salt1.equals(salt2)).toBe(false);
  });
  test('key generation is deterministic with a given salt', async () => {
    const [key1, salt1] = await utils.generateKeyFromPass(
      'somepassword',
      'salt1',
    );
    const [key2, salt2] = await utils.generateKeyFromPass(
      'somepassword',
      'salt1',
    );
    expect(key1.equals(key2)).toBe(true);
    expect(salt1.equals(salt2)).toBe(true);
    const [key3, salt3] = utils.generateKeyFromPassSync(
      'somepassword',
      'salt1',
    );
    const [key4, salt4] = utils.generateKeyFromPassSync(
      'somepassword',
      'salt1',
    );
    expect(key3.equals(key4)).toBe(true);
    expect(salt3.equals(salt4)).toBe(true);
  });
  test('encryption and decryption', async () => {
    const plainText = Buffer.from('hello world', 'utf-8');
    const cipherText = await utils.encrypt(key, plainText);
    const plainText_ = await utils.decrypt(key, cipherText);
    expect(plainText_).toBeDefined();
    expect(plainText).toEqual(Buffer.from(plainText_!));
  });
  test('block offset is position % block size', async () => {
    expect(utils.blockOffset(4096, 0)).toBe(0);
    expect(utils.blockOffset(4096, 1)).toBe(1);
    expect(utils.blockOffset(4096, 4095)).toBe(4095);
    expect(utils.blockOffset(4096, 4096)).toBe(0);
    expect(utils.blockOffset(4096, 4097)).toBe(1);
  });
  test('number of blocks to be written', async () => {
    const blockSize = 4096;
    const blockOffset = utils.blockOffset(blockSize, 4099);
    expect(utils.blockLength(blockSize, blockOffset, 10)).toBe(1);
    expect(utils.blockLength(blockSize, blockOffset, 4096)).toBe(2);
  });
  test('block index start', async () => {
    expect(utils.blockIndexStart(4096, 0)).toBe(0);
    expect(utils.blockIndexStart(4096, 1)).toBe(0);
    expect(utils.blockIndexStart(4096, 4095)).toBe(0);
    expect(utils.blockIndexStart(4096, 4096)).toBe(1);
    expect(utils.blockIndexStart(4096, 4097)).toBe(1);
  });
  test('block index end', async () => {
    let blockSize, bytePosition, byteLength;
    let blockOffset, blockCount, blockIndexStart, blockIndexEnd;
    blockSize = 3;
    bytePosition = 2;
    byteLength = 1;
    blockOffset = utils.blockOffset(blockSize, bytePosition);
    blockCount = utils.blockLength(blockSize, blockOffset, byteLength);
    blockIndexStart = utils.blockIndexStart(blockSize, bytePosition);
    blockIndexEnd = utils.blockIndexEnd(blockIndexStart, blockCount);
    expect(blockIndexStart).toBe(0);
    expect(blockIndexEnd).toBe(0);
    blockSize = 3;
    bytePosition = 2;
    byteLength = 2;
    blockOffset = utils.blockOffset(blockSize, bytePosition);
    blockCount = utils.blockLength(blockSize, blockOffset, byteLength);
    blockIndexStart = utils.blockIndexStart(blockSize, bytePosition);
    blockIndexEnd = utils.blockIndexEnd(blockIndexStart, blockCount);
    expect(blockIndexStart).toBe(0);
    expect(blockIndexEnd).toBe(1);
    blockSize = 3;
    bytePosition = 2;
    byteLength = 4;
    blockOffset = utils.blockOffset(blockSize, bytePosition);
    blockCount = utils.blockLength(blockSize, blockOffset, byteLength);
    blockIndexStart = utils.blockIndexStart(blockSize, bytePosition);
    blockIndexEnd = utils.blockIndexEnd(blockIndexStart, blockCount);
    expect(blockIndexStart).toBe(0);
    expect(blockIndexEnd).toBe(1);
    blockSize = 3;
    bytePosition = 2;
    byteLength = 5;
    blockOffset = utils.blockOffset(blockSize, bytePosition);
    blockCount = utils.blockLength(blockSize, blockOffset, byteLength);
    blockIndexStart = utils.blockIndexStart(blockSize, bytePosition);
    blockIndexEnd = utils.blockIndexEnd(blockIndexStart, blockCount);
    expect(blockIndexStart).toBe(0);
    expect(blockIndexEnd).toBe(2);
  });
  test('block cursor', async () => {
    let blockSize, bytePosition, byteLength;
    let blockCursorStart, blockCursorEnd;
    blockSize = 3;
    bytePosition = 2;
    byteLength = 1;
    blockCursorStart = utils.blockOffset(blockSize, bytePosition);
    blockCursorEnd = utils.blockOffset(
      blockSize,
      bytePosition + byteLength - 1,
    );
    expect(blockCursorStart).toBe(2);
    expect(blockCursorEnd).toBe(2);
    blockSize = 3;
    bytePosition = 2;
    byteLength = 2;
    blockCursorStart = utils.blockOffset(blockSize, bytePosition);
    blockCursorEnd = utils.blockOffset(
      blockSize,
      bytePosition + byteLength - 1,
    );
    expect(blockCursorStart).toBe(2);
    expect(blockCursorEnd).toBe(0);
    blockSize = 3;
    bytePosition = 2;
    byteLength = 4;
    blockCursorStart = utils.blockOffset(blockSize, bytePosition);
    blockCursorEnd = utils.blockOffset(
      blockSize,
      bytePosition + byteLength - 1,
    );
    expect(blockCursorStart).toBe(2);
    expect(blockCursorEnd).toBe(2);
    blockSize = 3;
    bytePosition = 4;
    byteLength = 5;
    blockCursorStart = utils.blockOffset(blockSize, bytePosition);
    blockCursorEnd = utils.blockOffset(
      blockSize,
      bytePosition + byteLength - 1,
    );
    expect(blockCursorStart).toBe(1);
    expect(blockCursorEnd).toBe(2);
  });
  test('buffer segmentation', async () => {
    const buffer = Buffer.from('Testing Buffer');
    let blockSize, bufferSegments;
    blockSize = 3;
    bufferSegments = utils.segmentBuffer(blockSize, buffer);
    expect(bufferSegments.length).toBe(5);
    expect(bufferSegments[0]).toStrictEqual(Buffer.from('Tes'));
    expect(bufferSegments[1]).toStrictEqual(Buffer.from('tin'));
    expect(bufferSegments[2]).toStrictEqual(Buffer.from('g B'));
    expect(bufferSegments[3]).toStrictEqual(Buffer.from('uff'));
    expect(bufferSegments[4]).toStrictEqual(Buffer.from('er'));
    blockSize = 2;
    bufferSegments = utils.segmentBuffer(blockSize, buffer);
    expect(bufferSegments.length).toBe(7);
    expect(bufferSegments[0]).toStrictEqual(Buffer.from('Te'));
    expect(bufferSegments[1]).toStrictEqual(Buffer.from('st'));
    expect(bufferSegments[2]).toStrictEqual(Buffer.from('in'));
    expect(bufferSegments[3]).toStrictEqual(Buffer.from('g '));
    expect(bufferSegments[4]).toStrictEqual(Buffer.from('Bu'));
    expect(bufferSegments[5]).toStrictEqual(Buffer.from('ff'));
    expect(bufferSegments[6]).toStrictEqual(Buffer.from('er'));
    blockSize = 15;
    bufferSegments = utils.segmentBuffer(blockSize, buffer);
    expect(bufferSegments.length).toBe(1);
    expect(bufferSegments[0]).toStrictEqual(Buffer.from('Testing Buffer'));
  });
  describe('maybeCallback', () => {
    async function passthrough(
      arg: string,
      shouldThrow: boolean,
      callback?: Callback<[string]>,
    ) {
      return await maybeCallback(async () => {
        if (shouldThrow) throw Error('Throwing an error');
        return arg;
      }, callback);
    }
    describe('as a promise', () => {
      test('Should function', async () => {
        const message = 'Hello world!';
        const response = await passthrough(message, false);
        expect(response).toEqual(message);
      });
      test('Should throw error', async () => {
        const message = 'Hello world!';
        await expect(passthrough(message, true)).rejects.toThrow();
      });
    });
    describe('as a callback', () => {
      test('Should function', async () => {
        const message = 'Hello world!';
        let resolvePromise;
        const prom = new Promise((resolve) => {
          resolvePromise = resolve;
        });
        await passthrough(message, false, (err, response) => {
          expect(response).toEqual(message);
          resolvePromise(response);
        });
        await prom;
      });
      test('Should throw error', async () => {
        const message = 'Hello world!';
        let resolvePromise;
        const prom = new Promise((resolve) => {
          resolvePromise = resolve;
        });
        await passthrough(message, true, (err, response) => {
          expect(err).toBeInstanceOf(Error);
          resolvePromise(response);
        });
        await prom;
      });
    });
  });
});
