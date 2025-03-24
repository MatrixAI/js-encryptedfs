import type { WorkerManifest } from '@matrixai/workers';
import type { Crypto } from '@matrixai/db';
import { expose } from '@matrixai/workers';
import * as utils from './utils.js';

const efsWorker: Crypto = {
  async encrypt({
    key,
    plainText,
  }: {
    key: ArrayBuffer;
    plainText: ArrayBuffer;
  }): Promise<{ data: ArrayBuffer; transferList: [ArrayBuffer] }> {
    const cipherText = await utils.encrypt(key, plainText);
    return { data: cipherText, transferList: [cipherText] };
  },
  async decrypt({
    key,
    cipherText,
  }: {
    key: ArrayBuffer;
    cipherText: ArrayBuffer;
  }): Promise<
    | { data: ArrayBuffer; transferList: [ArrayBuffer] }
    | { data: undefined; transferList: [] }
  > {
    const plainText = await utils.decrypt(key, cipherText);
    if (plainText != null) {
      return { data: plainText, transferList: [plainText] };
    } else {
      return { data: undefined, transferList: [] };
    }
  },
} satisfies WorkerManifest;

expose(efsWorker);

type EFSWorker = typeof efsWorker;

export type { EFSWorker };

export default efsWorker;
