import type { TransferDescriptor } from 'threads';

import { Transfer } from 'threads';
import * as utils from '../utils';

const efsWorker = {
  async encrypt(
    key: ArrayBuffer,
    plainText: ArrayBuffer,
  ): Promise<TransferDescriptor<ArrayBuffer>> {
    const cipherText = await utils.encrypt(key, plainText);
    return Transfer(cipherText);
  },
  async decrypt(
    key: ArrayBuffer,
    cipherText: ArrayBuffer,
  ): Promise<TransferDescriptor<ArrayBuffer> | undefined> {
    const plainText = await utils.decrypt(key, cipherText);
    if (plainText != null) {
      return Transfer(plainText);
    } else {
      return;
    }
  },
};

type EFSWorkerModule = typeof efsWorker;

export type { EFSWorkerModule };

export default efsWorker;
