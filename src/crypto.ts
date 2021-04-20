import { cipher, sha256, util as forgeUtil } from 'node-forge';
import { getRandomBytesSync } from './util';

function encryptBlock(key: Buffer, blockBuffer: Buffer): Buffer {
  const initVector = getRandomBytesSync(16);
  const c = cipher.createCipher('AES-GCM', key.toString('binary'));
  c.start({ iv: initVector.toString('binary'), tagLength: 128 });
  c.update(forgeUtil.createBuffer(blockBuffer));
  c.finish();
  const cipherText = Buffer.from(c.output.getBytes(), 'binary');
  const authTag = Buffer.from(c.mode.tag.getBytes(), 'binary');
  return Buffer.concat([initVector, authTag, cipherText]);
}

function decryptChunk(key: Buffer, chunkBuffer: Buffer): Buffer | undefined {
  if (chunkBuffer.length <= 32) {
    return;
  }
  const iv = chunkBuffer.subarray(0, 16);
  const authTag = chunkBuffer.subarray(16, 32);
  const cipherText_ = chunkBuffer.subarray(32);
  const d = cipher.createDecipher('AES-GCM', key.toString('binary'));
  d.start({
    iv: iv.toString('binary'),
    tag: authTag,
  });
  d.update(forgeUtil.createBuffer(cipherText_));
  if (!d.finish()) {
    return;
  }
  return Buffer.from(d.output.getBytes(), 'binary');
}

function hash(data: string | Buffer): Buffer {
  const hash = sha256.create('sha256');
  hash.update(data);
  return hash.digest();
}

function getCryptoBuffer(data: string | Buffer): Buffer {
  return forgeUtil.createBuffer(data);
}

export { encryptBlock, decryptChunk, hash, getCryptoBuffer };
