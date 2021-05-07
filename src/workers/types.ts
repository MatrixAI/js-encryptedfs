import Logger from '@matrixai/logger';

interface WorkerManagerInterface<T> {
  pool?;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
  call<R>(f: (worker: T) => Promise<R>): Promise<R>;
  queue<R>(f: (worker: T) => Promise<R>);
  completed(): Promise<void>;
  settled(): Promise<Error[]>;
}

export default WorkerManagerInterface;
