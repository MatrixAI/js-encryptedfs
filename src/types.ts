import type fs from 'fs';
import type * as vfs from 'virtualfs';
import type { Mutex } from 'async-mutex';
import type { INodeIndex } from './inodes/types';
import type { FdIndex } from './fd/types';

/**
 * Plain data dictionary
 */
type POJO = { [key: string]: any };

/**
 * Opaque types are wrappers of existing types
 * that require smart constructors
 */
type Opaque<K, T> = T & { __TYPE__: K };

/**
 * Any type that can be turned into a string
 */
interface ToString {
  toString(): string;
}

/**
 * Generic callback
 */
type Callback<P extends Array<any> = [], R = any, E extends Error = Error> = {
  (e: E, ...params: Partial<P>): R;
  (e: null | undefined, ...params: P): R;
};

type FunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];

/**
 * Functional properties of an object
 */
type FunctionProperties<T> = Pick<T, FunctionPropertyNames<T>>;

type NonFunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends Function ? never : K;
}[keyof T];

/**
 * Non-functional properties of an object
 */
type NonFunctionProperties<T> = Pick<T, NonFunctionPropertyNames<T>>;

type Navigated = {
  dir: INodeIndex;
  target: INodeIndex | undefined;
  name: string;
  remaining: string;
  pathStack: string[];
};

type ParsedPath = {
  segment: string;
  rest: string;
};

type path = string | Buffer | URL;

type options = {
  encoding?: BufferEncoding | undefined;
  mode?: number;
  flag?: string;
};

type data = string | Buffer | Uint8Array;

type file = FdIndex | path;

// we want to take in types from the relevant db types
// queue
// that's the common types
// you know
// callbacks must take nothing
// no actually void really
// we are not capturing anything
// they are pure side effects to be executed
// during a bathc
// unless batch
// right now batch runs
// and then we run with the batched up operations as well
// type QueueUp = {
//   // ops: Array<DBOp>;
//   callbacks: Array<() => void>;
// };

// const x: QueueUp = {
//   callbacks: [
//     () => {},
//     () => { console.log('hello'); },
//     async () => {
//       console.log('oh');
//       return 1;
//     }
//   ]
// };

// random callbacks to perform
// but these may be other
// queuing up the transformations
// after the batching succeeds
// it makes sense that these are not asynchronous?

/**
 * Minimal filesystem type
 * Based on the required operations from fs/promises
 * Implement this with platform-specific filesystem
 */
interface FileSystem {
  mkdir: typeof fs.mkdir;
  promises: {
    rm: typeof fs.promises.rm;
    stat: typeof fs.promises.stat;
    readFile: typeof fs.promises.readFile;
    writeFile: typeof fs.promises.writeFile;
    copyFile: typeof fs.promises.copyFile;
    mkdir: typeof fs.promises.mkdir;
    readdir: typeof fs.promises.readdir;
    rename: typeof fs.promises.rename;
    open: typeof fs.promises.open;
  };
}

// we may not need this anymore
// since reading any blocks require taking it from the underlying fs
// and so it's no longer in-memory anymore

type BlockMeta = {
  loaded: Set<number>;
};

type EncryptedFSLayer = 'upper' | 'lower' | 'middle';

export type {
  POJO,
  Opaque,
  ToString,
  Callback,
  FunctionProperties,
  NonFunctionProperties,
  FileSystem,
  EncryptedFSLayer,
  BlockMeta,
  Navigated,
  ParsedPath,
  path,
  options,
  data,
  file,
};
