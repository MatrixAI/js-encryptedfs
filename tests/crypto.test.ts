import * as utils from '@/util';
import * as cryptoUtils from '@/crypto';

describe('EFS crypto', () => {
  let key: Buffer;

  beforeEach(() => {
    key = utils.getRandomBytesSync(16);
  });

  test('encrypt - sync', () => {
    const plaintext = Buffer.from('very important secret');
    const chunk1 = cryptoUtils.encryptBlock(key, plaintext);
    const chunk2 = cryptoUtils.encryptBlock(key, plaintext);
    const decryptedText1 = cryptoUtils.decryptChunk(key, chunk1);
    const decryptedText2 = cryptoUtils.decryptChunk(key, chunk2);
    expect(decryptedText2).toEqual(decryptedText1);
  });

  test('decrypt - sync', () => {
    const plainBuf = Buffer.from('very important secret');
    const cipherText = cryptoUtils.encryptBlock(key, plainBuf);
    const deciphered = cryptoUtils.decryptChunk(key, cipherText);
    expect(deciphered).toEqual(plainBuf);
  });

  test('hash - sync', () => {
    const plainBuf = Buffer.from('very important secret');
    const plainBuf2 = Buffer.from('not so important secret');
    const hash = cryptoUtils.hash(plainBuf);
    const hash2 = cryptoUtils.hash(plainBuf);
    expect(hash).toStrictEqual(hash2);
    const hash3 = cryptoUtils.hash(plainBuf2);
    expect(hash).not.toStrictEqual(hash3);
  });
});
