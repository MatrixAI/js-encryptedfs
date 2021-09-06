import * as util from '@/util';

describe('main', () => {
  // ported over
  describe('key generation', () => {
    // test('key 16 bytes', () => {
    //   const key = util.generateMasterKey('password');
    //   expect(key.length).toBe(16);
    // });
    // test('key is randomly generated', () => {
    //   const key1 = util.generateMasterKey('password');
    //   const key2 = util.generateMasterKey('password');
    //   expect(key1).not.toStrictEqual(key2);
    // });
  });
  describe('random bytes generation', () => {
    // test('buffer is specified length', () => {
    //   const buf1 = util.getRandomBytesSync(1);
    //   expect(buf1.length).toBe(1);
    //   const buf2 = util.getRandomBytesSync(100);
    //   expect(buf2.length).toBe(100);
    //   const buf3 = util.getRandomBytesSync(1000);
    //   expect(buf3.length).toBe(1000);
    // });
    // test('key is randomly generated', () => {
    //   const buf1 = util.getRandomBytesSync(10);
    //   const buf2 = util.getRandomBytesSync(10);
    //   expect(buf1).not.toStrictEqual(buf2);
    // });
  });

  // TODO....

  describe('block array functions', () => {
    // we shouldn't need to use this function
    // a range operator is better

    // test('various get block cases', () => {
    //   expect(util.getBlocksToWrite(2000, 100, 4096)).toEqual([0]);
    //   expect(util.getBlocksToWrite(13000, 100, 4096)).toEqual([3]);
    //   expect(util.getBlocksToWrite(0, 100, 4096)).toEqual([0]);
    //   expect(util.getBlocksToWrite(0, 8000, 4096)).toEqual([0, 1]);
    //   expect(util.getBlocksToWrite(0, 4096, 4096)).toEqual([0]);
    //   expect(util.getBlocksToWrite(0, 4097, 4096)).toEqual([0, 1]);
    //   expect(util.getBlocksToWrite(8000, 8000, 4096)).toEqual([1, 2, 3]);
    // });
    test('various block compare cases', () => {
      expect(util.compareBlockArrays([2], [1, 2, 3, 4, 5, 6])).toBeTruthy();
      expect(
        util.compareBlockArrays([2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]),
      ).toBeTruthy();
      expect(
        util.compareBlockArrays([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]),
      ).toBeTruthy();
      expect(
        util.compareBlockArrays([2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6]),
      ).toBeFalsy();
      expect(util.compareBlockArrays([10], [1, 2, 3, 4, 5, 6])).toBeFalsy();
      expect(util.compareBlockArrays([1], [1])).toBeTruthy();
    });
  });
});
