import type { DBDomain } from './types';

import {
  random,
  cipher,
  util as forgeUtil,
} from 'node-forge';
import sublevelprefixer from 'sublevel-prefixer';
import * as dbErrors from './errors';

const ivSize = 16;
const authTagSize = 16;
const prefixer = sublevelprefixer('!');

function domainPath(levels: DBDomain, key: string|Buffer): string | Buffer {
  if (!levels.length) {
    return key;
  }
  let prefix = key;
  for (let i = levels.length - 1; i >= 0; i--) {
    prefix = prefixer(levels[i], prefix);
  }
  return prefix;
}

function serialize<T>(value: T): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf-8');
}

function deserialize<T>(value_: Buffer): T {
  try {
    return JSON.parse(value_.toString('utf-8'));
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new dbErrors.ErrorDBParse();
    }
    throw e;
  }
}

function getRandomBytesSync(size: number): Buffer {
  return Buffer.from(random.getBytesSync(size), 'binary');
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

export {
  domainPath,
  serialize,
  deserialize,
  encryptWithKey,
  decryptWithKey
 };
