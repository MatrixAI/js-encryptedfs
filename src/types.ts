import type { Mutex } from 'async-mutex';
import type fs from 'fs';

/**
 * Plain data dictionary
 */
type POJO = { [key: string]: any };

type EncryptedFSLayer = 'upper' | 'lower';

// type UpperDirectoryMetadata = {
//   size: number;
//   keyHash: Buffer;
// };

// we would need to give it a normal lock too
// each path has a lock
// otherwise the they have to set it
// if you set it
// nothing else can get it
// so as soon as you create it
// you lock it?
type MappedMeta = {
  lock: Mutex;
  meta: fs.Stats,
};


export type {
  POJO,
  EncryptedFSLayer,
  MappedMeta
};
