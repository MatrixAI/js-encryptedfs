import type { EFSWorker } from './efsWorkerModule';
import { expose } from 'threads/worker';

import polykeyWorker from './efsWorkerModule';

expose(polykeyWorker);

export type { EFSWorker };
