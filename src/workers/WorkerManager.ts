import type { ModuleThread } from 'threads';
import type { QueuedTask } from 'threads/dist/master/pool-types';
import type { EFSWorker } from './efsWorker';

import os from 'os';
import { spawn, Pool, Worker } from 'threads';
import Logger from '@matrixai/logger';
import * as workersErrors from './errors';

class WorkerManager {
  protected pool?: Pool<ModuleThread<EFSWorker>>;
  protected logger: Logger;

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
      throw new workersErrors.ErrorNotRunning();
    }
    return await this.pool.queue(f);
  }

  public queue<T>(
    f: (worker: ModuleThread<EFSWorker>) => Promise<T>,
  ): QueuedTask<ModuleThread<EFSWorker>, T> {
    if (!this.pool) {
      throw new workersErrors.ErrorNotRunning();
    }
    return this.pool.queue(f);
  }

  public async completed(): Promise<void> {
    if (!this.pool) {
      throw new workersErrors.ErrorNotRunning();
    }
    return await this.pool.completed();
  }

  public async settled() {
    if (!this.pool) {
      throw new workersErrors.ErrorNotRunning();
    }
    return await this.pool.settled();
  }
}

export default WorkerManager;
