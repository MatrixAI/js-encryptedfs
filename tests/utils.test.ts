import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as utils from '@/utils';

describe('utils', () => {
  const logger = new Logger('EFS Worker Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
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
    const [key1, salt1] = await utils.generateKeyFromPass('somepassword', 'salt1');
    const [key2, salt2] = await utils.generateKeyFromPass('somepassword', 'salt1');
    expect(key1.equals(key2)).toBe(true);
    expect(salt1.equals(salt2)).toBe(true);
  });
  test('encryption and decryption', async () => {
    const plainText = Buffer.from('hello world', 'utf-8');
    const cipherText = utils.encryptWithKey(key, plainText);
    const plainText_ = utils.decryptWithKey(key, cipherText);
    expect(plainText_).toBeDefined();
    expect(plainText.equals(plainText_!)).toBe(true);
  });
  test('block index', async () => {
    expect(utils.posToBlockIndex(4096, 0)).toBe(0);
    expect(utils.posToBlockIndex(4096, 1)).toBe(0);
    expect(utils.posToBlockIndex(4096, 4095)).toBe(0);
    expect(utils.posToBlockIndex(4096, 4096)).toBe(1);
    expect(utils.posToBlockIndex(4096, 4097)).toBe(1);
  });
  test('block offset', async () => {
    // the plain text position can be mapped to a block offset
    // which is the length from the beginning the target block
    expect(utils.posToBlockOffset(4096, 0)).toBe(0);
    expect(utils.posToBlockOffset(4096, 1)).toBe(1);
    expect(utils.posToBlockOffset(4096, 4095)).toBe(4095);
    expect(utils.posToBlockOffset(4096, 4096)).toBe(0);
    expect(utils.posToBlockOffset(4096, 4097)).toBe(1);
  });
  test('number of blocks to be written', async () => {
    const blockSize = 4096;
    const blockOffset = utils.posToBlockOffset(blockSize, 4099);
    expect(utils.countBlocks(blockSize, blockOffset, 10)).toBe(1);
    expect(utils.countBlocks(blockSize, blockOffset, 4096)).toBe(2);
  });
});
