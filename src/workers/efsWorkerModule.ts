import type { TransferDescriptor } from 'threads';

import { isWorkerRuntime, Transfer } from 'threads';
import * as utils from '../utils';

/**
 * Worker object that contains all functions that will be executed in parallel
 * Functions should be using CPU-parallelism not IO-parallelism
 * Most functions should be synchronous, not asynchronous
 * Making them asynchronous does not make a difference to the caller
 * The caller must always await because the fucntions will run on the pool
 */
const efsWorker = {
  /**
   * Check if we are running in the worker.
   * Only used for testing
   */
  isRunningInWorker(): boolean {
    return isWorkerRuntime();
  },
  /**
   * Sleep synchronously
   * This blocks the entire event loop
   * Only used for testing
   */
  sleep(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    return;
  },
  /**
   * Zero copy encryption of plain text to cipher text
   */
  encryptWithKey(
    key: ArrayBuffer,
    keyOffset: number,
    keyLength: number,
    plainText: ArrayBuffer,
    plainTextOffset: number,
    plainTextLength: number,
  ): TransferDescriptor<[ArrayBuffer, number, number]> {
    const key_ = Buffer.from(key, keyOffset, keyLength);
    const plainText_ = Buffer.from(plainText, plainTextOffset, plainTextLength);
    const cipherText = utils.encryptWithKey(key_, plainText_);
    return Transfer(
      [cipherText.buffer, cipherText.byteOffset, cipherText.byteLength],
      [cipherText.buffer],
    );
  },
  /**
   * Zero copy decryption of cipher text to plain text
   */
  decryptWithKey(
    key: ArrayBuffer,
    keyOffset: number,
    keyLength: number,
    cipherText: ArrayBuffer,
    cipherTextOffset: number,
    cipherTextLength: number,
  ): TransferDescriptor<[ArrayBuffer, number, number]> | undefined {
    const key_ = Buffer.from(key, keyOffset, keyLength);
    const cipherText_ = Buffer.from(
      cipherText,
      cipherTextOffset,
      cipherTextLength,
    );
    const plainText = utils.decryptWithKey(key_, cipherText_);
    if (plainText != null) {
      return Transfer(
        [plainText.buffer, plainText.byteOffset, plainText.byteLength],
        [plainText.buffer],
      );
    } else {
      return;
    }
  },
};

type EFSWorker = typeof efsWorker;

export type { EFSWorker };

export default efsWorker;
