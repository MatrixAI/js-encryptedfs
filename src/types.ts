import type fs from 'fs';
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
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];

/**
 * Functional properties of an object
 */
type FunctionProperties<T> = Pick<T, FunctionPropertyNames<T>>;

type NonFunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K;
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

type Path = string | Buffer | URL;

type Options = {
  encoding?: BufferEncoding | undefined;
  mode?: number;
  flag?: string;
};

type Data = string | Buffer | Uint8Array;

type File = FdIndex | Path;

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

export type {
  POJO,
  Opaque,
  ToString,
  Callback,
  FunctionProperties,
  NonFunctionProperties,
  FileSystem,
  Navigated,
  ParsedPath,
  Path,
  Options,
  Data,
  File,
};
