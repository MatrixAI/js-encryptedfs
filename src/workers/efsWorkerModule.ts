import type { TransferDescriptor } from 'threads';

import { Transfer } from 'threads';
import * as utils from '../utils';

const efsWorker = {
  efsEncryptWithKey(
    key: ArrayBuffer,
    plainText: ArrayBuffer,
  ): TransferDescriptor<ArrayBuffer> {
    const keyBuffer = utils.fromArrayBuffer(key);
    const plainTextBuffer = utils.fromArrayBuffer(plainText);
    const cipherTextBuffer = utils.encryptWithKey(keyBuffer, plainTextBuffer);
    const cipherText = utils.toArrayBuffer(cipherTextBuffer);
    return Transfer(cipherText);
  },
  efsDecryptWithKey(
    key: ArrayBuffer,
    cipherText: ArrayBuffer,
  ): TransferDescriptor<ArrayBuffer> | undefined {
    const keyBuffer = utils.fromArrayBuffer(key);
    const cipherTextBuffer = utils.fromArrayBuffer(cipherText);
    const plainTextBuffer = utils.decryptWithKey(keyBuffer, cipherTextBuffer);
    if (plainTextBuffer != null) {
      const plainText = utils.toArrayBuffer(plainTextBuffer);
      return Transfer(plainText);
    } else {
      return;
    }
  },
};

type EFSWorkerModule = typeof efsWorker;

export type { EFSWorkerModule };

export default efsWorker;
