import type { EFSWorker } from './efsWorkerModule';
import { expose } from 'threads/worker';

import efsWorker from './efsWorkerModule';

expose(efsWorker);

export type { EFSWorker };
