import type { ModuleThread } from 'threads';
import type { QueuedTask } from 'threads/dist/master/pool-types';
import type { EFSWorker } from './efsWorker';

import os from 'os';
import { spawn, Pool, Worker } from 'threads';
import Logger from '@matrixai/logger';
import { WorkerManagerInterface } from './types';
import * as workersErrors from './errors';

/**
 * Consider putting this into a separate library.
 * So that we can have a worker...
 * Library.
 * Note that it must spawn a particular file.
 * In this case, it is always spawning the realtive the current file.
 * And this way you can construct one relative to it.
 */

class WorkerManager implements WorkerManagerInterface<EFSWorker> {
  pool?;
  logger: Logger;

  constructor({
    logger,
  }: {
    logger?: Logger;
  } = {}) {
    this.logger = logger ?? new Logger('WorkerManager');
  }

  public async start() {
    const coreCount = os.cpus().length;
    this.pool = Pool(() => spawn(new Worker('./efsWorker')), coreCount);
    this.logger.info(`Started worker pool with ${coreCount} workers`);
  }

  public async stop() {
    if (this.pool) {
      await this.pool.terminate();
      delete this.pool;
    }
  }

  public async call<T>(
    f: (worker: ModuleThread<EFSWorker>) => Promise<T>,
  ): Promise<T> {
    if (!this.pool) {
      throw new workersErrors.EncryptedFSWorkerNotRunningError();
    }
    return await this.pool.queue(f);
  }

  public queue<R>(
    f: (worker: ModuleThread<EFSWorker>) => Promise<R>,
  ): QueuedTask<ModuleThread<EFSWorker>, R> {
    if (!this.pool) {
      throw new workersErrors.EncryptedFSWorkerNotRunningError();
    }
    return this.pool.queue(f);
  }

  public async completed(): Promise<void> {
    if (!this.pool) {
      throw new workersErrors.EncryptedFSWorkerNotRunningError();
    }
    return await this.pool.completed();
  }

  public async settled() {
    if (!this.pool) {
      throw new workersErrors.EncryptedFSWorkerNotRunningError();
    }
    return await this.pool.settled();
  }
}

export default WorkerManager;
