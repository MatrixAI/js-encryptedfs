import type { EFSWorkerModule } from './efsWorkerModule';
import { expose } from 'threads/worker';

import efsWorker from './efsWorkerModule';

expose(efsWorker);

export type { EFSWorkerModule };
