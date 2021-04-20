import { isWorkerRuntime } from 'threads/worker';
import * as cryptoUtils from '../crypto';

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
  encryptBlock(key: string, blockBuffer: string): string {
    const block = cryptoUtils.encryptBlock(
      Buffer.from(key, 'binary'),
      Buffer.from(blockBuffer, 'binary'),
    );
    return block.toString('binary');
  },
  decryptChunk(key: string, chunkBuffer: string): string | undefined {
    const chunk = cryptoUtils.decryptChunk(
      Buffer.from(key, 'binary'),
      Buffer.from(chunkBuffer, 'binary'),
    );
    if (chunk) {
      return chunk.toString();
    } else {
      return;
    }
  },
};

type EFSWorker = typeof efsWorker;

export type { EFSWorker };

export default efsWorker;
