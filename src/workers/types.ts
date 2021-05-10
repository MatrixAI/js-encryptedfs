import Logger from '@matrixai/logger';
import type { ModuleThread } from 'threads';
import type { ModuleMethods } from 'threads/dist/types/master';

interface WorkerManagerInterface<T extends ModuleMethods> {
  pool?;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
  call<R>(f: (worker: ModuleThread<T>) => Promise<R>): Promise<R>;
  completed(): Promise<void>;
  settled(): Promise<Error[]>;
}

export default WorkerManagerInterface;
