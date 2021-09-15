import type { WorkerManagerInterface } from '@matrixai/workers';
import type { EFSWorkerModule } from './efsWorkerModule';

type EFSWorkerManagerInterface = WorkerManagerInterface<EFSWorkerModule>;

export { default as efsWorkerModule } from './efsWorkerModule';

export type { EFSWorkerModule, EFSWorkerManagerInterface };
