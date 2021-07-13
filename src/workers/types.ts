import Logger from '@matrixai/logger';
import type { ModuleThread } from 'threads';
import type { ModuleMethods } from 'threads/dist/types/master';
import type { QueuedTask } from 'threads/dist/master/pool-types';

interface WorkerManagerInterface<T extends ModuleMethods> {
  pool?;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
  call<R>(f: (worker: ModuleThread<T>) => Promise<R>): Promise<R>;
  queue<R>(f: (worker: ModuleThread<T>) => Promise<R>): QueuedTask<ModuleThread<T>, R>;
  completed(): Promise<void>;
  settled(): Promise<Error[]>;
}

export type {
  WorkerManagerInterface
};
