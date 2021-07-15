import type { Mutex } from 'async-mutex';
import type fs from 'fs';

/**
 * Plain data dictionary
 */
type POJO = { [key: string]: any };

type UpperDirectoryMetadata = {
  size: number;
  keyHash: Buffer;
};

type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'latin1'
  | 'binary'
  | 'hex';


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
  UpperDirectoryMetadata,
  MappedMeta
};
