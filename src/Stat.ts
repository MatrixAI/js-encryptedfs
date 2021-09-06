import type { NonFunctionProperties } from './types';

import * as vfs from 'virtualfs';

/**
 * Parameters to construct a Stat object
 */
type StatParams = {
  dev?: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev?: number;
  size: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
  blksize?: number;
  blocks?: number;
};

/**
 * Properties of a Stat object
 */
type StatProps = NonFunctionProperties<Stat>;

/**
 * Stat metadata object
 * The blksize is the plain block size
 * The blocks is the count of the plain blocks
 */
class Stat extends vfs.Stat {
  blksize: number;
  blocks: number;
  constructor(params: StatParams) {
    super(params);
    this.blksize = params.blksize ?? 0;
    this.blocks = params.blocks ?? 0;
  }

  getProps(): StatProps {
    return { ...this };
  }
}

export default Stat;

export type { StatParams, StatProps };
