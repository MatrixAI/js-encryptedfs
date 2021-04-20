import * as util from '@/util';

describe('main', () => {
  describe('key generation', () => {
    test('key 16 bytes', () => {
      const key = util.generateMasterKey('password');
      expect(key.length).toBe(16);
    });
    test('key is randomly generated', () => {
      const key1 = util.generateMasterKey('password');
      const key2 = util.generateMasterKey('password');
      expect(key1).not.toStrictEqual(key2);
    });
  });
  describe('random bytes generation', () => {
    test('buffer is specified length', () => {
      const buf1 = util.getRandomBytesSync(1);
      expect(buf1.length).toBe(1);
      const buf2 = util.getRandomBytesSync(100);
      expect(buf2.length).toBe(100);
      const buf3 = util.getRandomBytesSync(1000);
      expect(buf3.length).toBe(1000);
    });
    test('key is randomly generated', () => {
      const buf1 = util.getRandomBytesSync(10);
      const buf2 = util.getRandomBytesSync(10);
      expect(buf1).not.toStrictEqual(buf2);
    });
  });
});
