import type { WorkerManagerInterface } from '@matrixai/workers';
import type { INodeIndex } from './inodes/types';
import type { FdIndex } from './fd/types';
import type { EFSWorkerModule } from './workers/efsWorkerModule';

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
 * Non-empty array
 */
type NonEmptyArray<T> = [T, ...T[]];

/**
 * Any type that can be turned into a string
 */
interface ToString {
  toString(): string;
}

/**
 * Wrap a type to be reference counted
 * Useful for when we need to garbage collect data
 */
type Ref<T> = {
  count: number;
  value: T;
};

/**
 * Generic callback
 */
type Callback<P extends Array<any> = [], R = any, E extends Error = Error> = {
  (e: E, ...params: Partial<P>): R;
  (e?: null | undefined, ...params: P): R;
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
  recursive?: boolean;
};

type Data = string | Buffer | Uint8Array;

type File = FdIndex | Path;

type EFSWorkerManagerInterface = WorkerManagerInterface<EFSWorkerModule>;

export type {
  POJO,
  Opaque,
  NonEmptyArray,
  ToString,
  Ref,
  Callback,
  FunctionProperties,
  NonFunctionProperties,
  Navigated,
  ParsedPath,
  Path,
  Options,
  Data,
  File,
  EFSWorkerManagerInterface,
  EFSWorkerModule,
};
