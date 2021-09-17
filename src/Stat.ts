import type { NonFunctionProperties } from './types';
import * as constants from './constants';

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
class Stat {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
  blksize: number;
  blocks: number;

  /**
   * Creates Stat.
   */
  constructor(params: StatParams) {
    this.dev = params.dev || 0; // In-memory has no devices
    this.ino = params.ino;
    this.mode = params.mode;
    this.nlink = params.nlink;
    this.uid = params.uid;
    this.gid = params.gid;
    this.rdev = params.rdev || 0; // Is 0 for regular files and directories
    this.size = params.size;
    this.atime = params.atime;
    this.mtime = params.mtime;
    this.ctime = params.ctime;
    this.birthtime = params.birthtime;
    this.blksize = params.blksize ?? 0;
    this.blocks = params.blocks ?? 0;
  }

  /**
   * Checks if file.
   */
  isFile(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFREG;
  }

  /**
   * Checks if directory.
   */
  isDirectory(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFDIR;
  }

  /**
   * Checks if symbolic link.
   */
  isSymbolicLink(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFLNK;
  }

  /**
   * Checks if FIFO.
   */
  isFIFO(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFIFO;
  }

  /**
   * Checks if socket.
   */
  isSocket(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFSOCK;
  }
}

export default Stat;

export type { StatParams, StatProps };
