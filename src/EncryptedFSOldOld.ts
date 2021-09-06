import type { UpperDirectoryMetadata, BufferEncoding } from './types';
import fs from 'fs';
import pathNode from 'path';
import { nextTick } from 'process';
import {
  Stat,
  VirtualFS,
  FileDescriptorManager,
  INodeManager,
  DeviceManager,
} from 'virtualfs';
import * as utils from './util';
import FileDescriptor from './FileDescriptor';
import { constants, DEFAULT_FILE_PERM } from './constants';
import { EncryptedFSError, errno } from './EncryptedFSError';
import { EncryptedFSLayers, cryptoConstants } from './util';
import { optionsStream, ReadStream, WriteStream } from './Streams';
import * as cryptoUtils from './crypto';
import { WorkerManager } from './workers';

const callbackUp = (err) => {
  if (err) throw err;
};

const callbackUpData = (err, data) => {
  if (err) throw err;
  return data;
};

// TODO: rmdirSync on VFS doesn't have an option to recusively delete

/**
 * Encrypted filesystem written in TypeScript for Node.js.
 * @param key A key.
 * @param upperDir The upper directory file system.
 * @param lowerDir The lower directory file system.
 * @param initVectorSize The size of the initial vector, defaults to 16.
 * @param blockSize The size of block, defaults to 4096.
 * @param cryptoLib The library to use for cryptography
 */
class EncryptedFS {
  protected umask: number;
  protected upperDir: any;
  protected lowerDir: typeof fs;
  protected chunkSize: number;
  protected blockSize: number;
  protected fileDescriptors: Map<number, FileDescriptor>;
  protected masterKey: Buffer;
  protected metadata: { [fd: number]: UpperDirectoryMetadata };
  protected meta: { [path: string]: fs.Stats };
  protected blockMapping: { [path: string]: Array<number> };
  protected upperBasePath: string;
  protected lowerBasePath: string;
  protected deviceManager: DeviceManager;
  protected iNodeManager: INodeManager;
  protected fdManager: FileDescriptorManager;
  protected workerManager?: WorkerManager;
  protected noatime: boolean;
  constants: any;

  constructor(
    key: Buffer | string,
    lowerDir: typeof fs,
    lowerBasePath: string = '',
    umask: number = 0o022,
    blockSize: number = 4096,
    noatime: boolean = false,
  ) {
    this.umask = umask;
    // Set key
    if (typeof key === 'string') {
      this.masterKey = Buffer.from(key);
    } else {
      this.masterKey = key;
    }
    (this.deviceManager = new DeviceManager()),
      (this.iNodeManager = new INodeManager(this.deviceManager)),
      (this.fdManager = new FileDescriptorManager(this.iNodeManager));
    this.upperDir = new VirtualFS(
      0o022,
      null,
      this.deviceManager,
      this.iNodeManager,
      this.fdManager,
    );
    this.lowerDir = lowerDir;
    this.blockSize = blockSize;
    this.blockMapping = {};
    this.chunkSize =
      this.blockSize +
      cryptoConstants.INIT_VECTOR_LEN +
      cryptoConstants.AUTH_TAG_LEN;
    this.fileDescriptors = new Map();
    this.metadata = {};
    this.meta = {};
    this.constants = constants;
    this.lowerBasePath = lowerBasePath;
    this.noatime = noatime;
  }

  public setWorkerManager(workerManager: WorkerManager) {
    this.workerManager = workerManager;
  }

  public unsetWorkerManager() {
    delete this.workerManager;
  }

  getumask(): number {
    return this.umask;
  }

  getuid(): number {
    return this.upperDir.getUid();
  }

  setuid(uid: number): void {
    this.upperDir.setUid(uid);
  }

  getgid(): number {
    return this.upperDir.getGid();
  }

  setgid(gid: number): void {
    this.upperDir.setGid(gid);
  }

  /**
   * Tests a user's permissions for the file specified by path.
   * @param fd File descriptor.
   */
  access(path: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.accessSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously tests a user's permissions for the file specified by path.
   * @param fd File descriptor.
   */
  accessSync(path: fs.PathLike, mode: number = this.constants.F_OK): void {
    if (this.upperDir.existsSync(path)) {
      this.upperDir.accessSync(path, mode);
    } else {
      this.loadMetaSync(this.getMetaName(path));
      this.setMetadata(path);
      this.upperDir.accessSync(path, mode);
    }
  }

  /**
   * Retrieves the path stats in the upper file system directory. Propagates upper fs method.
   * @param path Path to create.
   */
  lstat(path: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.lstatSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      (stat) => callback(null, stat),
      callback,
    );
    return;
  }

  /**
   * Synchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
   * @param path Path to create.
   */
  lstatSync(path: fs.PathLike): Stat {
    if (this.upperDir.existsSync(path)) {
      return this.upperDir.lstatSync(path);
    }
    this.loadMetaSync(this.getMetaName(path));
    this.setMetadata(path);
    return this.upperDir.lstatSync(path);
  }

  /**
   * Makes the directory in the upper file system directory. Propagates upper fs method.
   */
  mkdir(path: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.mkdirSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously makes the directory in the upper file system directory. Propagates upper fs method.
   * @param path Path to create.
   * @param mode number | undefined. Permissions or mode.
   */
  mkdirSync(
    path: fs.PathLike,
    options: fs.MakeDirectoryOptions = { mode: 0o777, recursive: false },
  ): void {
    if (options.recursive) {
      this.upperDir.mkdirpSync(path, options.mode);
    } else {
      this.upperDir.mkdirSync(path, options.mode);
    }
    const dataPath = utils.addSuffix(this.getPath(path));
    this.lowerDir.mkdirSync(`${this.lowerBasePath}/${dataPath}`, options);
    const dirs = utils.getDirsRecursive(this.getPath(path));
    let navPath = '';
    for (const dir of dirs) {
      navPath += `${dir}/`;
      this.meta[this.getMetaName(navPath)] = this.upperDir.statSync(navPath);
      this.writeMetaSync(this.getMetaName(navPath));
    }
  }

  /**
   * Makes a temporary directory with the prefix given.
   * @param prefix Prefix of temporary directory.
   * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
   */
  mkdtemp(
    prefix: string,
    options:
      | { encoding: BufferEncoding }
      | BufferEncoding
      | null
      | undefined = 'utf8',
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.mkdtempSync.bind(this),
      [prefix, options, ...args.slice(0, cbIndex)],
      (path) => callback(null, path),
      callback,
    );
    return;
  }

  /**
   * Synchronously makes a temporary directory with the prefix given.
   * @param prefix Prefix of temporary directory.
   * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
   */
  mkdtempSync(
    prefix: string,
    options:
      | { encoding: BufferEncoding }
      | BufferEncoding
      | null
      | undefined = 'utf8',
  ): string {
    const lowerPath = this.lowerDir.mkdtempSync(
      `${this.lowerBasePath}/${prefix}`,
      options,
    );
    this.upperDir.mkdirpSync(pathNode.basename(prefix));
    return pathNode.basename(lowerPath as string);
  }

  /**
   * Retrieves  in the upper file system directory. Propagates upper fs method.
   */
  stat(path: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.statSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      (stat) => callback(null, stat),
      callback,
    );
    return;
  }

  /**
   * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
   */
  statSync(path: fs.PathLike): Stat {
    if (this.upperDir.existsSync(path)) {
      return this.upperDir.statSync(path);
    }
    this.loadMetaSync(this.getMetaName(path));
    this.setMetadata(path);
    return this.upperDir.statSync(path);
  }

  /**
   * Removes the directory in the upper file system directory. Propagates upper fs method.
   */
  rmdir(path: string, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.rmdirSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously removes the directory in the upper file system directory. Propagates upper fs method.
   * @param path Path to create.
   * @param options: { recursive: boolean }.
   */
  rmdirSync(
    path: fs.PathLike,
    options: fs.RmDirOptions | undefined = undefined,
  ): void {
    try {
      const dirs = utils.getDirsRecursive(this.getPath(path));
      let navPath = '';
      let counter = 1;
      for (const dir of dirs) {
        if (counter < dirs.length) {
          counter++;
          navPath += `${dir}/`;
          this.accessSync(navPath, this.constants.W_OK);
          delete this.meta[this.getMetaName(navPath)];
        }
      }
      if (!options?.recursive) {
        this.upperDir.rmdirSync(path);
      }
      this.lowerDir.rmdirSync(
        `${this.lowerBasePath}/${utils.addSuffix(path)}`,
        options,
      );
      const dir = utils.addSuffix(pathNode.dirname(path.toString()));
      const base = pathNode.basename(path.toString());
      this.lowerDir.unlinkSync(`${this.lowerBasePath}/${dir}/.${base}.meta`);
    } catch (err) {
      if (err.errno) {
        throw new EncryptedFSError(
          {
            errno: err.errno,
            code: err.code,
            description: err.errnoDescription,
          },
          path,
          null,
          err.syscall,
        );
      } else {
        throw err;
      }
    }
  }

  /**
   * Creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
   * @param target Destination path.
   * @param path Source path.
   */
  symlink(target: fs.PathLike, path: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.symlinkSync.bind(this),
      [target, path, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
   * @param dstPath Destination path.
   * @param srcPath Source path.
   */
  symlinkSync(
    target: fs.PathLike,
    path: fs.PathLike,
    type: 'dir' | 'file' | 'junction' | null | undefined = 'file',
  ): void {
    this.upperDir.symlinkSync(target, path, type);
    this.lowerDir.symlinkSync(
      `${this.lowerBasePath}/${utils.addSuffix(target)}`,
      `${this.lowerBasePath}/${utils.addSuffix(path)}`,
      type,
    );
    this.meta[this.getMetaName(path)] = this.upperDir.lstatSync(path);
    this.writeMetaSync(this.getMetaName(path.toString()));
  }

  /**
   * Changes the size of the file by len bytes.
   */
  truncate(file: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.truncateSync.bind(this),
      [file, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously changes the size of the file by len bytes.
   */
  truncateSync(file: fs.PathLike, len: number = 0): void {
    if (this.upperDir.existsSync(file)) {
      this.upperDir.truncateSync(file, len);
    } else {
      this.loadMetaSync(this.getMetaName(file));
      this.meta[this.getMetaName(file)].size = len;
      this.meta[this.getMetaName(file)].ctime = new Date();
      this.meta[this.getMetaName(file)].mtime = new Date();
      this.setMetadata(file);
    }
    this.writeMetaSync(this.getMetaName(file));
  }

  /**
   * Unlinks the given path in the upper and lower file system directories.
   * @param path Path to create.
   */
  unlink(path: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.unlinkSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously unlinks the given path in the upper and lower file system directories.
   * @param path Path to create.
   */
  unlinkSync(path: fs.PathLike): void {
    this.accessSync(path, constants.W_OK | constants.X_OK);
    const _path = utils.getPathToMeta(path);
    this.lowerDir.unlinkSync(`${this.lowerBasePath}/${_path}`);
    this.lowerDir.unlinkSync(`${this.lowerBasePath}/${utils.addSuffix(path)}`);
    if (this.upperDir.existsSync(path)) {
      this.upperDir.unlinkSync(path);
    }
  }

  /**
   * Changes the access and modification times of the file referenced by path.
   * @param path Path to file.
   * @param atime number | string | Date. Access time.
   * @param mtime number | string | Date. Modification time.
   */
  utimes(
    path: fs.PathLike,
    atime: number | string | Date,
    mtime: number | string | Date,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.utimesSync.bind(this),
      [path, atime, mtime, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously changes the access and modification times of the file referenced by path.
   * @param path Path to file.
   * @param atime number | string | Date. Access time.
   * @param mtime number | string | Date. Modification time.
   */
  utimesSync(
    path: fs.PathLike,
    atime: number | string | Date,
    mtime: number | string | Date,
  ): void {
    if (this.upperDir.existsSync(path)) {
      this.upperDir.utimesSync(path, atime, mtime);
    } else {
      let newAtime;
      let newMtime;
      if (typeof atime === 'number') {
        newAtime = new Date(atime * 1000);
      } else if (typeof atime === 'string') {
        newAtime = new Date(parseInt(atime) * 1000);
      } else if (atime instanceof Date) {
        newAtime = atime;
      } else {
        throw TypeError('atime and mtime must be dates or unixtime in seconds');
      }
      if (typeof mtime === 'number') {
        newMtime = new Date(mtime * 1000);
      } else if (typeof mtime === 'string') {
        newMtime = new Date(parseInt(mtime) * 1000);
      } else if (mtime instanceof Date) {
        newMtime = mtime;
      } else {
        throw TypeError('atime and mtime must be dates or unixtime in seconds');
      }
      this.loadMetaSync(path);
      this.meta[this.getMetaName(path)].atime = newAtime;
      this.meta[this.getMetaName(path)].mtime = newMtime;
      this.meta[this.getMetaName(path)].ctime = new Date();
      this.setMetadata(path);
    }
    this.writeMetaSync(path);
  }

  /**
   * Closes the file descriptor.
   * @param fd number. File descriptor.
   */
  close(fd: number, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.closeSync.bind(this),
      [fd, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously closes the file descriptor.
   * @param fd number. File descriptor.
   */
  closeSync(fd: number): void {
    const isUserFileDescriptor = this.isFileDescriptor(fd);
    if (isUserFileDescriptor) {
      const lowerFd = this.getLowerFd(fd);
      this.lowerDir.closeSync(lowerFd);
      this.upperDir.closeSync(fd);
      this.fileDescriptors.delete(fd);
    }
  }

  /**
   * Writes buffer (with length) to the file descriptor at an offset and position.
   * @param path Path to directory to be read.
   * @param options FileOptions.
   */
  readdir(path: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.readdirSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      (files) => callback(null, files),
      callback,
    );
    return;
  }

  /**
   * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
   * @param path Path to directory to be read.
   * @param options FileOptions.
   */
  readdirSync(
    path: fs.PathLike,
    options?: { encoding: BufferEncoding; withFileTypes?: false },
  ): string[] {
    if (path != '') {
      this.accessSync(path, this.constants.R_OK);
    }
    const list = this.lowerDir.readdirSync(
      `${this.lowerBasePath}/${utils.addSuffix(path)}`,
      options,
    );
    const newList: string[] = [];
    for (const entry in list) {
      if (list[entry].substring(list[entry].length - 5) === '.data') {
        newList.push(list[entry].substring(0, list[entry].length - 5));
      } else if (!(list[entry].substring(list[entry].length - 5) === '.meta')) {
        newList.push(list[entry]);
      }
    }
    return newList;
  }

  /**
   * Creates a read stream from the given path and options.
   * @param path
   */
  createReadStream(
    path: fs.PathLike,
    options: optionsStream | undefined,
  ): ReadStream {
    path = this.getPath(path);
    options = this.getStreamOptions(
      {
        flags: 'r',
        encoding: undefined,
        fd: null,
        mode: DEFAULT_FILE_PERM,
        autoClose: true,
        end: Infinity,
      },
      options,
    );
    if (options.start !== undefined) {
      if (options.start > options.end!) {
        throw new RangeError('ERR_VALUE_OUT_OF_RANGE');
      }
    }
    return new ReadStream(path, options, this);
  }

  /**
   * Creates a write stream from the given path and options.
   * @param path
   */
  createWriteStream(
    path: fs.PathLike,
    options: optionsStream | undefined,
  ): WriteStream {
    path = this.getPath(path);
    options = this.getStreamOptions(
      {
        flags: 'w',
        encoding: 'utf8',
        fd: null,
        mode: DEFAULT_FILE_PERM,
        autoClose: true,
      },
      options,
    );
    if (options.start !== undefined) {
      if (options.start < 0) {
        throw new RangeError('ERR_VALUE_OUT_OF_RANGE');
      }
    }
    return new WriteStream(path, options, this);
  }

  /**
   * Checks if path exists.
   * @param path
   */
  exists(path: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.existsSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      (exist) => callback(null, exist),
      callback,
    );
    return;
  }

  /**
   * Synchronously checks if path exists.
   * @param path
   */
  existsSync(path: fs.PathLike): boolean {
    return this.lowerDir.existsSync(
      `${this.lowerBasePath}/${utils.addSuffix(path)}`,
    );
  }

  /**
   * Manipulates the allocated disk space for a file.
   * @param fdIndex number. File descriptor index.
   * @param offset number. Offset to start manipulations from.
   * @param len number. New length for the file.
   */
  fallocate(
    fdIndex: number,
    offset: number,
    len: number,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.fallocateSync.bind(this),
      [fdIndex, offset, len, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously manipulates the allocated disk space for a file.
   * @param fdIndex number. File descriptor index.
   * @param offset number. Offset to start manipulations from.
   * @param len number. New length for the file.
   */
  fallocateSync(fdIndex: number, offset: number, len: number): void {
    const path = this.getMetaPath(fdIndex);
    if (this.upperDir.existsSync(this.getMetaPath(fdIndex))) {
      this.upperDir.fallocateSync(fdIndex, offset, len);
    } else {
      this.loadMetaSync(this.getMetaName(path));
      this.meta[this.getMetaName(path)].size = len;
      this.meta[this.getMetaName(path)].ctime = new Date();
      this.setMetadata(path);
    }
    this.writeMetaSync(this.getMetaName(path));
  }

  /**
   * Changes the permissions of the file referred to by fdIndex.
   * @param fdIndex number. File descriptor index.
   * @param mode number. New permissions set.
   */
  fchmod(fdIndex: number, mode: number = 0, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.fchmodSync.bind(this),
      [fdIndex, mode, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously changes the permissions of the file referred to by fdIndex.
   * @param fdIndex number. File descriptor index.
   * @param mode number. New permissions set.
   */
  fchmodSync(fdIndex: number, mode: number = 0): void {
    const path = this.getMetaPath(fdIndex);
    if (this.upperDir.existsSync(this.getMetaPath(fdIndex))) {
      this.upperDir.fchmodSync(
        fdIndex,
        (this.upperDir.fstatSync(fdIndex).mode & constants.S_IFMT) | mode,
      );
    } else {
      this.loadMetaSync(this.getMetaName(path));
      this.meta[this.getMetaPath(fdIndex)].mode =
        (this.meta[this.getMetaPath(fdIndex)].mode & constants.S_IFMT) | mode;
      this.setMetadata(path);
    }
    this.writeMetaSync(this.getMetaPath(fdIndex));
  }

  /**
   * Changes the owner or group of the file referred to by fdIndex.
   * @param fdIndex number. File descriptor index.
   * @param uid number. User identifier.
   * @param gid number. Group identifier.
   */
  fchown(fdIndex: number, uid: number, gid: number, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.fchownSync.bind(this),
      [fdIndex, uid, gid, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously changes the owner or group of the file referred to by fdIndex.
   * @param fdIndex number. File descriptor index.
   * @param uid number. User identifier.
   * @param gid number. Group identifier.
   */
  fchownSync(fdIndex: number, uid: number, gid: number): void {
    const path = this.getMetaPath(fdIndex);
    if (this.upperDir.existsSync(this.getMetaPath(fdIndex))) {
      this.upperDir.fchownSync(fdIndex, uid, gid);
    } else {
      this.loadMetaSync(this.getMetaName(path));
      this.meta[path].uid = uid;
      this.meta[path].gid = gid;
      this.setMetadata(path);
    }
    this.writeMetaSync(path);
  }

  /**
   * Flushes in memory data to disk. Not required to update metadata.
   * @param fdIndex number. File descriptor index.
   */
  fdatasync(fdIndex: number, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.fdatasyncSync.bind(this),
      [fdIndex, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously flushes in memory data to disk. Not required to update metadata.
   * @param fdIndex number. File descriptor index.
   */
  fdatasyncSync(fdIndex: number): void {
    if (this.upperDir.existsSync(this.getMetaPath(fdIndex))) {
      this.upperDir.fdatasyncSync(fdIndex);
    }
    this.lowerDir.fdatasyncSync(this.getLowerFd(fdIndex));
  }

  /**
   * Retrieves data about the file described by fdIndex.
   * @param fdIndex number. File descriptor.
   */
  fstat(fdIndex: number, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.fstatSync.bind(this),
      [fdIndex, ...args.slice(0, cbIndex)],
      (stats) => callback(null, stats),
      callback,
    );
    return;
  }

  /**
   * Synchronously retrieves data about the file described by fdIndex.
   * @param fd number. File descriptor.
   */
  fstatSync(fdIndex: number): Stat {
    const path = this.getMetaPath(fdIndex);
    if (this.upperDir.existsSync(path)) {
      return this.upperDir.fstatSync(fdIndex);
    }
    this.loadMetaSync(this.getMetaName(path));
    this.setMetadata(path);
    return this.upperDir.fstatSync(fdIndex);
  }

  /**
   * Flushes all modified data to disk.
   * @param fdIndex number. File descriptor index.
   */
  fsync(fdIndex: number, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.fsyncSync.bind(this),
      [fdIndex, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously flushes all modified data to disk.
   * @param fdIndex number. File descriptor index.
   */
  fsyncSync(fdIndex: number): void {
    if (this.upperDir.existsSync(this.getMetaPath(fdIndex))) {
      this.upperDir.fsyncSync(fdIndex);
    }
    this.lowerDir.fsyncSync(this.getLowerFd(fdIndex));
  }

  /**
   * Truncates to given length.
   * @param fdIndex number. File descriptor index
   * @param len number. Length to truncate to.
   */
  ftruncate(fdIndex: number, len: number = 0, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.ftruncateSync.bind(this),
      [fdIndex, len, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously truncates to given length.
   * @param fdIndex number. File descriptor index
   * @param len number. Length to truncate to.
   */
  ftruncateSync(fdIndex: number, len: number = 0): void {
    const path = this.getMetaPath(fdIndex);
    if (this.upperDir.existsSync(path)) {
      this.upperDir.ftruncateSync(fdIndex, len);
    } else {
      this.loadMetaSync(this.getMetaName(path));
      this.meta[this.getMetaName(path)].size = len;
      this.meta[this.getMetaName(path)].ctime = new Date();
      this.meta[this.getMetaName(path)].mtime = new Date();
      this.setMetadata(path);
    }
    this.writeMetaSync(this.getMetaName(path));
  }

  /**
   * Changes the access and modification times of the file referenced by fdIndex.
   * @param fdIndex number. File descriptor index
   * @param atime number | string | Date. Access time.
   * @param mtime number | string | Date. Modification time.
   */
  futimes(
    fdIndex: number,
    atime: number | string | Date,
    mtime: number | string | Date,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.futimesSync.bind(this),
      [fdIndex, atime, mtime, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously changes the access and modification times of the file referenced by fdIndex.
   * @param fdIndex number. File descriptor index
   * @param atime number | string | Date. Access time.
   * @param mtime number | string | Date. Modification time.
   */
  futimesSync(
    fdIndex: number,
    atime: number | string | Date,
    mtime: number | string | Date,
  ): void {
    const path = this.getMetaPath(fdIndex);
    if (this.upperDir.existsSync(path)) {
      this.upperDir.futimesSync(fdIndex, atime, mtime);
    } else {
      this.loadMetaSync(this.getMetaName(path));
      let newAtime;
      let newMtime;
      if (typeof atime === 'number') {
        newAtime = new Date(atime * 1000);
      } else if (typeof atime === 'string') {
        newAtime = new Date(parseInt(atime) * 1000);
      } else if (atime instanceof Date) {
        newAtime = atime;
      } else {
        throw TypeError('atime and mtime must be dates or unixtime in seconds');
      }
      if (typeof mtime === 'number') {
        newMtime = new Date(mtime * 1000);
      } else if (typeof mtime === 'string') {
        newMtime = new Date(parseInt(mtime) * 1000);
      } else if (mtime instanceof Date) {
        newMtime = mtime;
      } else {
        throw TypeError('atime and mtime must be dates or unixtime in seconds');
      }
      this.meta[path].atime = newAtime;
      this.meta[path].mtime = newMtime;
      this.meta[path].ctime = new Date();
      this.setMetadata(path);
    }
    this.writeMetaSync(path);
  }

  /**
   * Links a path to a new path.
   * @param existingPath
   * @param newPath
   */
  link(
    existingPath: fs.PathLike,
    newPath: fs.PathLike,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.linkSync.bind(this),
      [existingPath, newPath, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously links a path to a new path.
   * @param existingPath
   * @param newPath
   */
  linkSync(existingPath: fs.PathLike, newPath: fs.PathLike): void {
    this.lowerDir.linkSync(
      `${this.lowerBasePath}/${utils.addSuffix(existingPath)}`,
      `${this.lowerBasePath}/${utils.addSuffix(newPath)}`,
    );
    this.upperDir.linkSync(existingPath, newPath);
    this.meta[this.getMetaName(existingPath)].ctime = new Date();
    this.meta[this.getMetaName(existingPath)].nlink += 1;
    this.writeMetaSync(this.getMetaName(existingPath));
    this.meta[this.getMetaName(newPath)] = this.upperDir.lstatSync(newPath);
    this.writeMetaSync(this.getMetaName(newPath));
  }

  /**
   * Reads data from a file given the path of that file.
   * @param path Path to file.
   */
  readFile(path: fs.PathLike | number, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.readFileSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      (data) => callback(null, data),
      callback,
    );
    return;
  }

  /**
   * Synchronously reads data from a file given the path of that file.
   * @param path Path to file.
   */
  readFileSync(
    path: fs.PathLike | number,
    options?: fs.WriteFileOptions,
  ): string | Buffer {
    const optionsInternal = this.getFileOptions(
      { encoding: null, mode: 0o666, flag: 'r' },
      options,
    );
    let fd: number | null = null;
    let exists = false;
    let _path: fs.PathLike;
    try {
      if (typeof path === 'number') {
        fd = path as number;
        _path = this.getMetaPath(fd);
        // Check if file exists on the upper directory
        if (this.upperDir.existsSync(_path)) {
          exists = true;
        }
      } else {
        _path = path;
        // Check if file exists on the upper directory
        if (this.upperDir.existsSync(_path)) {
          exists = true;
        }
        fd = this.openSync(path, optionsInternal.flag, optionsInternal.mode);
      }
      // Check if file descriptor points to directory
      if (this.fstatSync(fd).isDirectory()) {
        throw new EncryptedFSError(errno.EISDIR, path, null, 'read', null);
      }
      const size = this.getMetadata(fd).size;
      const readBuffer = Buffer.alloc(size);
      // If file exists on the upper dir read directly from there
      // Otherwise, decrypt from the lower dir and cache in upper dir
      if (exists) {
        this.upperDir.readSync(fd, readBuffer, 0, size, 0);
        // If the user has set noatime, then dont encrypt and write the
        // metadata (writing the metadata is resource expensive)
        if (!this.noatime) {
          this.writeMetaSync(_path);
        }
        return optionsInternal.encoding
          ? readBuffer.toString(optionsInternal.encoding)
          : readBuffer;
      } else {
        this.readSync(fd, readBuffer, 0, size, 0);
        const newfd = this.upperDir.openSync(_path, 'w');
        this.upperDir.writeFileSync(newfd, readBuffer);
        this.loadMetaSync(_path);
        this.setMetadata(_path);
        this.upperDir.closeSync(newfd);
        return optionsInternal.encoding
          ? readBuffer.toString(optionsInternal.encoding)
          : readBuffer;
      }
    } finally {
      if (fd) {
        this.closeSync(fd);
      }
    }
  }

  /**
   * Reads link of the given the path. Propagated from upper fs.
   * @param path Path to file.
   * @param options FileOptions | undefined.
   */
  readlink(
    path: fs.PathLike,
    options: fs.WriteFileOptions,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.readlinkSync.bind(this),
      [path, options, ...args.slice(0, cbIndex)],
      (data) => callback(null, data),
      callback,
    );
    return;
  }

  /**
   * Synchronously reads link of the given the path. Propagated from upper fs.
   * @param path Path to file.
   * @param options FileOptions | undefined.
   */
  readlinkSync(
    path: fs.PathLike,
    options: fs.WriteFileOptions,
  ): string | Buffer {
    return this.upperDir.readlinkSync(path, options);
  }

  /**
   * Determines the actual location of path. Propagated from upper fs.
   * @param path Path to file.
   * @param options FileOptions | undefined.
   */
  realpath(
    path: fs.PathLike,
    options: fs.WriteFileOptions,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.realpathSync.bind(this),
      [path, options, ...args.slice(0, cbIndex)],
      (data) => callback(null, data),
      callback,
    );
    return;
  }

  /**
   * Synchronously determines the actual location of path. Propagated from upper fs.
   * @param path Path to file.
   * @param options FileOptions | undefined.
   */
  realpathSync(
    path: fs.PathLike,
    options: fs.WriteFileOptions | undefined = undefined,
  ): string | Buffer {
    return this.upperDir.realpathSync(path, options);
  }

  /**
   * Renames the file system object described by oldPath to the given new path. Propagated from upper fs.
   * @param oldPath Old path.
   * @param newPath New path.
   */
  rename(
    oldPath: fs.PathLike,
    newPath: fs.PathLike,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.renameSync.bind(this),
      [oldPath, newPath, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
   * @param oldPath Old path.
   * @param newPath New path.
   */
  renameSync(oldPath: fs.PathLike, newPath: fs.PathLike): void {
    if (this.upperDir.existsSync(oldPath)) {
      this.upperDir.renameSync(oldPath, newPath);
    } else {
      this.meta[this.getMetaName(newPath)].ctime = new Date();
    }
    this.meta[this.getMetaName(newPath)] = this.meta[this.getMetaName(oldPath)];
    delete this.meta[this.getMetaName(oldPath)];
    const _oldPath = utils.getPathToMeta(oldPath);
    const _newPath = utils.getPathToMeta(newPath);
    this.lowerDir.renameSync(
      `${this.lowerBasePath}/${utils.addSuffix(oldPath)}`,
      `${this.lowerBasePath}/${utils.addSuffix(newPath)}`,
    );
    this.lowerDir.renameSync(
      `${this.lowerBasePath}/${_oldPath}`,
      `${this.lowerBasePath}/${_newPath}`,
    );
    this.writeMetaSync(newPath);
  }

  /**
   * Reads data at an offset, position and length from a file descriptor into a given buffer.
   * @param fd number. File descriptor.
   * @param buffer Buffer. Buffer to be written from.
   * @param offset number. The offset in the buffer at which to start writing.
   * @param length number. The number of bytes to read.
   * @param position number. The offset from the beginning of the file from which data should be read.
   */
  async read(
    fd: number,
    buffer: Buffer,
    offset: number = 0,
    length: number = buffer.length,
    position: number = 0,
    callback = callbackUpData,
  ): Promise<void> {
    if (offset < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'readSync');
    }
    if (length < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'readSync');
    }
    if (position < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'readSync');
    }
    // Check if file descriptor points to directory
    this.fstat(fd, (e, stat) => {
      if (e) throw e;
      if (stat.isDirectory()) {
        throw new EncryptedFSError(errno.EISDIR, fd, null, 'readSync');
      }
    });
    const filePath = this.getMetaPath(fd);
    const exists = utils.compareBlockArrays(
      utils.getBlocksToWrite(position, length, this.blockSize),
      this.blockMapping[filePath],
    );
    if (exists) {
      this.upperDir.open(filePath, 'r+', async (e, fdindx) => {
        if (e) throw e;
        const bytesReadIn = this.upperDir.readSync(
          fdindx,
          buffer,
          offset,
          length,
          position,
        );
        // If the user has set noatime, then dont encrypt and write the
        // metadata (writing the metadata is resource expensive)
        if (!this.noatime) {
          await this.writeMeta(filePath);
        }
        this.upperDir.close(fdindx, (e) => {
          if (e) throw e;
          callback(null, bytesReadIn);
        });
      });
    }
    const lowerFd = this.getLowerFd(fd);
    const metadata = this.getMetadata(fd);
    if (position + length > metadata.size) {
      length = metadata.size - position;
    }

    // Accumulate plain text blocks in buffer array
    const blockBuffers: Buffer[] = [];

    // Determine chunk boundary conditions
    const numChunksToRead = Math.ceil(length / this.blockSize);
    const startBlockNum = this.offsetToBlockNum(position);
    const startChunkNum = startBlockNum;
    let blockBuffer;

    // Begin reading chunks
    for (
      let chunkCtr = startChunkNum;
      chunkCtr - startChunkNum < numChunksToRead;
      chunkCtr++
    ) {
      // Read the current block into chunkBuffer
      const chunkPosition = this.chunkNumToOffset(chunkCtr);
      const chunkBuffer = Buffer.alloc(this.chunkSize);
      await utils.promisify(this.lowerDir.read.bind(this.lowerDir))(
        lowerFd,
        chunkBuffer,
        0,
        this.chunkSize,
        chunkPosition,
      );
      // Extract blockBuffer from chunkBuffer
      if (this.workerManager) {
        blockBuffer = await this.workerManager.call(async (w) => {
          const retBuf = await w.decryptChunk(
            this.masterKey.toString('binary'),
            chunkBuffer.toString('binary'),
          );
          if (retBuf) {
            return Buffer.from(retBuf);
          } else {
            throw Error('Chunk not decrypted');
          }
        });
      } else {
        blockBuffer = cryptoUtils.decryptChunk(this.masterKey, chunkBuffer);
      }
      blockBuffers.push(blockBuffer);
    }

    // Create buffer of all read blockBuffers
    blockBuffer = Buffer.concat(blockBuffers, numChunksToRead * this.blockSize);

    // Determine end condition of blockBuffer to write to
    const blockBufferStart = this.getBoundaryOffset(position);
    const blockBufferEnd = blockBufferStart + length;

    const bytesRead = blockBuffer.copy(
      buffer,
      offset,
      blockBufferStart,
      blockBufferEnd,
    );

    // // Write to upperDir (unencrypted)
    this.upperDir.open(filePath, 'w+', (e, fdi) => {
      if (e) throw e;
      this.upperDir.write(fdi, buffer, 0, buffer.length, position, (e) => {
        if (e) throw e;
        this.upperDir.closeSync(fdi);
      });
    });

    // Update the block map with the new blocks written
    if (!this.blockMapping[filePath]) {
      this.blockMapping[filePath] = utils.getBlocksToWrite(
        position,
        length,
        this.blockSize,
      );
    } else {
      this.blockMapping[filePath].concat(
        utils.getBlocksToWrite(position, length, this.blockSize),
      );
    }
    callback(null, bytesRead);
  }

  /**
   * Synchronously reads data at an offset, position and length from a file descriptor into a given buffer.
   * @param fd number. File descriptor.
   * @param buffer Buffer. Buffer to be read into.
   * @param offset number. The offset in the buffer at which to start writing.
   * @param length number. The number of bytes to read.
   * @param position number. The offset from the beginning of the file from which data should be read.
   */
  readSync(
    fd: number,
    buffer: Buffer,
    offset: number = 0,
    length: number = buffer.length,
    position: number = 0,
  ): number {
    if (offset < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'readSync');
    }
    if (length < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'readSync');
    }
    if (position < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'readSync');
    }
    // Check if file descriptor points to directory
    if (this.fstatSync(fd).isDirectory()) {
      throw new EncryptedFSError(errno.EISDIR, fd, null, 'readSync');
    }
    try {
      const filePath = this.getMetaPath(fd);
      const fdindx = this.upperDir.openSync(filePath, 'r+');
      const exists = utils.compareBlockArrays(
        utils.getBlocksToWrite(position, length, this.blockSize),
        this.blockMapping[filePath],
      );
      if (exists) {
        const bytesReadIn = this.upperDir.readSync(
          fdindx,
          buffer,
          offset,
          length,
          position,
        );
        // If the user has set noatime, then dont encrypt and write the
        // metadata (writing the metadata is resource expensive)
        if (!this.noatime) {
          this.writeMetaSync(filePath);
        }
        this.upperDir.closeSync(fdindx);
        return bytesReadIn;
      }
      const lowerFd = this.getLowerFd(fd);
      const metadata = this.getMetadata(fd);
      if (position + length > metadata.size) {
        length = metadata.size - position;
      }

      // Accumulate plain text blocks in buffer array
      const blockBuffers: Buffer[] = [];

      // Determine chunk boundary conditions
      const numChunksToRead = Math.ceil(length / this.blockSize);
      const startBlockNum = this.offsetToBlockNum(position);
      const startChunkNum = startBlockNum;

      // Begin reading chunks
      for (
        let chunkCtr = startChunkNum;
        chunkCtr - startChunkNum < numChunksToRead;
        chunkCtr++
      ) {
        // Read the current block into chunkBuffer
        const chunkPosition = this.chunkNumToOffset(chunkCtr);
        const chunkBuffer = Buffer.alloc(this.chunkSize);
        this.lowerDir.readSync(
          lowerFd,
          chunkBuffer,
          0,
          this.chunkSize,
          chunkPosition,
        );

        // Extract blockBuffer from chunkBuffer
        const tempBlockBuffer = cryptoUtils.decryptChunk(
          this.masterKey,
          chunkBuffer,
        );
        if (!tempBlockBuffer) {
          throw Error('Decryption was unsuccessful');
        }
        blockBuffers.push(tempBlockBuffer);
      }

      // Create buffer of all read blockBuffers
      const blockBuffer = Buffer.concat(
        blockBuffers,
        numChunksToRead * this.blockSize,
      );

      // Determine end condition of blockBuffer to write to
      const blockBufferStart = this.getBoundaryOffset(position);
      const blockBufferEnd = blockBufferStart + length;

      const bytesRead = blockBuffer.copy(
        buffer,
        offset,
        blockBufferStart,
        blockBufferEnd,
      );

      // Write to upperDir (unencrypted)
      this.upperDir.writeSync(fdindx, buffer, 0, buffer.length, position);
      this.upperDir.closeSync(fdindx);
      // Update the block map with the new blocks written
      if (!this.blockMapping[filePath]) {
        this.blockMapping[filePath] = utils.getBlocksToWrite(
          position,
          length,
          this.blockSize,
        );
      } else {
        this.blockMapping[filePath].concat(
          utils.getBlocksToWrite(position, length, this.blockSize),
        );
      }

      return bytesRead;
    } catch (err) {
      if (err.errno) {
        throw new EncryptedFSError(
          {
            errno: err.errno,
            code: err.code,
            description: err.errnoDescription,
          },
          fd,
          null,
          err.syscall,
        );
      } else {
        throw err;
      }
    }
  }

  /**
   * Writes buffer (with length) to the file descriptor at an offset and position.
   * @param fd number. File descriptor.
   * @param buffer Buffer. Buffer to be written from.
   * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
   * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
   * @param position number. The offset from the beginning of the file where this data should be written.
   */
  async write(
    fd: number,
    buffer: Buffer,
    offset: number = 0,
    length: number = buffer.length - offset,
    position: number = 0,
    callback = callbackUpData,
  ): Promise<void> {
    if (offset < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'writeSync');
    }
    if (length < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'writeSync');
    }
    if (position < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'writeSync');
    }
    // Check if file descriptor points to directory
    this.fstat(fd, (e, stat) => {
      if (e) throw e;
      if (stat.isDirectory()) {
        throw new EncryptedFSError(errno.EISDIR, fd, null, 'readSync');
      }
    });
    const filePath = this.getMetaPath(fd);
    // Discriminate upper and lower file descriptors

    // upper fd index
    const upperFd = fd;

    // lower fd index
    // this goes through the intermediate FD wrapper to getthe lower fd index
    const lowerFd = this.getLowerFd(fd);

    // so the idea is that we have 2 fd indices we are managing here
    // and remember streams are complicated as well
    // one upper and one lower
    // we aren't extending the upperfd to keep track of the lower fd
    // although that would be nice, that wouldn't be an extension of VirtualFS
    // at least i dont think it can be because the APIs may be different

    // Get block boundary conditions
    const boundaryOffset = this.getBoundaryOffset(position); // how far from a block boundary our write is

    // the boundaryOffset may return -1
    // this doesn't make sense
    // as it means that if i write some bytes
    // from the last byte position of the initial block
    // it ends up telling me the wrong number of blocks to write

    const numBlocksToWrite = Math.ceil(
      (boundaryOffset + length) / this.blockSize,
    );

    // block index to start from
    const startBlockNum = this.offsetToBlockNum(position);

    // a one to one mapping of block to chunk
    const startChunkNum = startBlockNum;

    // the finish line
    const endBlockNum = startBlockNum + numBlocksToWrite - 1;

    let bufferBytesWritten: number = 0;

    // ================== Handle first block ================== //

    // the offset used here, is the offset into the input buffer
    // it has nothing to do with the first block

    const firstBlockStart = offset;

    const firstBlockEnd =
      firstBlockStart + Math.min(this.blockSize - boundaryOffset, length);

    const firstBlockOverlay = buffer.slice(firstBlockStart, firstBlockEnd);

    // what is this?

    const firstBlock = await this.overlaySegment(
      upperFd,
      firstBlockOverlay,
      position,
    );

    let firstChunk;
    let lastChunk;
    if (this.workerManager) {
      firstChunk = await this.workerManager.call(async (w) => {
        return Buffer.from(
          await w.encryptBlock(
            this.masterKey.toString('binary'),
            firstBlock.toString('binary'),
          ),
          'binary',
        );
      });
    } else {
      firstChunk = cryptoUtils.encryptBlock(this.masterKey, firstBlock);
    }
    bufferBytesWritten += firstBlockOverlay.length;

    // ================== Handle last block if needed ================== //
    const middleBlockLength = (numBlocksToWrite - 2) * this.blockSize;
    const lastBlockStart = firstBlockEnd + middleBlockLength;
    const lastBlockEnd =
      lastBlockStart + (length - (bufferBytesWritten + middleBlockLength));
    let lastBlock: Buffer | null;
    if (numBlocksToWrite >= 2) {
      const lastBlockOverlay = buffer.slice(lastBlockStart, lastBlockEnd);
      const lastBlockOffset = this.blockNumToOffset(endBlockNum);
      lastBlock = await this.overlaySegment(
        upperFd,
        lastBlockOverlay,
        lastBlockOffset,
      );
      if (this.workerManager) {
        lastChunk = await this.workerManager.call(async (w) => {
          return Buffer.from(
            await w.encryptBlock(
              this.masterKey.toString('binary'),
              firstBlock.toString('binary'),
            ),
            'binary',
          );
        });
      } else {
        lastChunk = cryptoUtils.encryptBlock(this.masterKey, firstBlock);
      }
      bufferBytesWritten += lastBlockOverlay.length;
    } else {
      lastBlock = null;
      lastChunk = null;
    }

    // ================== Handle middle blocks if needed ================== //
    // slice out middle blocks if they actually exist
    const middleBlocks: Buffer[] = [];
    const middleChunks: Buffer[] = [];
    let middleChunk;
    if (numBlocksToWrite >= 3) {
      const middleBlockBuffer = buffer.slice(firstBlockEnd, lastBlockStart);

      const blockIter = this.blockGenerator(middleBlockBuffer);
      let middleBlockCtr = startBlockNum + 1;
      for (const block of blockIter) {
        const middleBlockOffset = this.blockNumToOffset(middleBlockCtr);
        const middleBlock = await this.overlaySegment(
          upperFd,
          block,
          middleBlockOffset,
        );
        if (this.workerManager) {
          middleChunk = await this.workerManager.call(async (w) => {
            return Buffer.from(
              await w.encryptBlock(
                this.masterKey.toString('binary'),
                firstBlock.toString('binary'),
              ),
              'binary',
            );
          });
        } else {
          middleChunk = cryptoUtils.encryptBlock(this.masterKey, firstBlock);
        }
        middleBlocks.push(middleBlock);
        middleChunks.push(middleChunk);
        middleBlockCtr += 1;
        bufferBytesWritten += block.length;
      }
    }

    // ================== Concat blocks and write ================== //
    const totalBlocks: Buffer[] = [];
    totalBlocks.push(firstBlock);
    totalBlocks.push(...middleBlocks);
    if (lastBlock) {
      totalBlocks.push(lastBlock);
    }

    const blocks = Buffer.concat(
      totalBlocks,
      this.blockSize * numBlocksToWrite,
    );
    // Write to upperDir (unencrypted)
    await utils.promisify(this.upperDir.write.bind(this.upperDir))(
      upperFd,
      blocks,
      0,
      blocks.length,
      this.blockNumToOffset(startBlockNum),
    );

    // Update the block map with the new blocks written
    if (!this.blockMapping[filePath]) {
      this.blockMapping[filePath] = utils.getBlocksToWrite(
        position,
        length,
        this.blockSize,
      );
    } else {
      this.blockMapping[filePath].concat(
        utils.getBlocksToWrite(position, length, this.blockSize),
      );
    }
    // ================== Concat chunks and write ================== //
    const totalChunks: Buffer[] = [];
    totalChunks.push(firstChunk);
    totalChunks.push(...middleChunks);
    if (lastChunk) {
      totalChunks.push(lastChunk);
    }
    const chunks = Buffer.concat(
      totalChunks,
      this.chunkSize * numBlocksToWrite,
    );
    // Write to lowerDir (encrypted)
    this.lowerDir.writeSync(
      lowerFd,
      chunks,
      0,
      chunks.length,
      this.chunkNumToOffset(startChunkNum),
    );

    // ================== Handle and write metadata ================== //
    const newFileSize = position + length;

    if (newFileSize > this.getMetadata(fd).size) {
      this.getMetadata(fd).size = newFileSize;
      await this.writeMetadata(fd);
    }

    await this.writeMeta(filePath);

    callback(null, bufferBytesWritten);
  }

  /**
   * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
   * @param fd number. File descriptor.
   * @param buffer Buffer. Buffer to be written from.
   * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
   * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
   * @param position number. The offset from the beginning of the file where this data should be written.
   */
  writeSync(
    fd: number,
    buffer: Buffer,
    offset: number = 0,
    length: number = buffer.length - offset,
    position: number = 0,
  ): number {
    if (offset < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'writeSync');
    }
    if (length < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'writeSync');
    }
    if (position < 0) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'writeSync');
    }
    // Check if file descriptor points to directory
    if (this.fstatSync(fd).isDirectory()) {
      throw new EncryptedFSError(errno.EISDIR, fd, null, 'writeSync');
    }
    try {
      const filePath = this.getMetaPath(fd);
      // Discriminate upper and lower file descriptors
      const upperFd = fd;
      const lowerFd = this.getLowerFd(fd);

      // Get block boundary conditions
      const boundaryOffset = this.getBoundaryOffset(position); // how far from a block boundary our write is
      const numBlocksToWrite = Math.ceil(
        (boundaryOffset + length) / this.blockSize,
      );
      const startBlockNum = this.offsetToBlockNum(position);
      const startChunkNum = startBlockNum;
      const endBlockNum = startBlockNum + numBlocksToWrite - 1;

      let bufferBytesWritten: number = 0;

      // ================== Handle first block ================== //
      const firstBlockStart = offset;
      const firstBlockEnd =
        firstBlockStart + Math.min(this.blockSize - boundaryOffset, length);
      const firstBlockOverlay = buffer.slice(firstBlockStart, firstBlockEnd);
      const firstBlock = this.overlaySegmentSync(
        upperFd,
        firstBlockOverlay,
        position,
      );
      const firstChunk = cryptoUtils.encryptBlock(this.masterKey, firstBlock);
      bufferBytesWritten += firstBlockOverlay.length;

      // ================== Handle last block if needed ================== //
      const middleBlockLength = (numBlocksToWrite - 2) * this.blockSize;
      const lastBlockStart = firstBlockEnd + middleBlockLength;
      const lastBlockEnd =
        lastBlockStart + (length - (bufferBytesWritten + middleBlockLength));
      let lastBlock: Buffer | null;
      let lastChunk: Buffer | null;
      if (numBlocksToWrite >= 2) {
        const lastBlockOverlay = buffer.slice(lastBlockStart, lastBlockEnd);
        const lastBlockOffset = this.blockNumToOffset(endBlockNum);
        lastBlock = this.overlaySegmentSync(
          upperFd,
          lastBlockOverlay,
          lastBlockOffset,
        );
        lastChunk = cryptoUtils.encryptBlock(this.masterKey, lastBlock);
        bufferBytesWritten += lastBlockOverlay.length;
      } else {
        lastBlock = null;
        lastChunk = null;
      }

      // ================== Handle middle blocks if needed ================== //
      // slice out middle blocks if they actually exist
      const middleBlocks: Buffer[] = [];
      const middleChunks: Buffer[] = [];
      if (numBlocksToWrite >= 3) {
        const middleBlockBuffer = buffer.slice(firstBlockEnd, lastBlockStart);

        const blockIter = this.blockGenerator(middleBlockBuffer);
        let middleBlockCtr = startBlockNum + 1;
        for (const block of blockIter) {
          const middleBlockOffset = this.blockNumToOffset(middleBlockCtr);
          const middleBlock = this.overlaySegmentSync(
            upperFd,
            block,
            middleBlockOffset,
          );
          const middleChunk = cryptoUtils.encryptBlock(
            this.masterKey,
            middleBlock,
          );
          middleBlocks.push(middleBlock);
          middleChunks.push(middleChunk);
          middleBlockCtr += 1;
          bufferBytesWritten += block.length;
        }
      }

      // ================== Concat blocks and write ================== //
      const totalBlocks: Buffer[] = [];
      totalBlocks.push(firstBlock);
      totalBlocks.push(...middleBlocks);
      if (lastBlock) {
        totalBlocks.push(lastBlock);
      }

      const blocks = Buffer.concat(
        totalBlocks,
        this.blockSize * numBlocksToWrite,
      );
      // Write to upperDir (unencrypted)
      this.upperDir.writeSync(
        upperFd,
        blocks,
        0,
        blocks.length,
        this.blockNumToOffset(startBlockNum),
      );

      // Update the block map with the new blocks written
      if (!this.blockMapping[filePath]) {
        this.blockMapping[filePath] = utils.getBlocksToWrite(
          position,
          length,
          this.blockSize,
        );
      } else {
        this.blockMapping[filePath].concat(
          utils.getBlocksToWrite(position, length, this.blockSize),
        );
      }
      // ================== Concat chunks and write ================== //
      const totalChunks: Buffer[] = [];
      totalChunks.push(firstChunk);
      totalChunks.push(...middleChunks);
      if (lastChunk) {
        totalChunks.push(lastChunk);
      }
      const chunks = Buffer.concat(
        totalChunks,
        this.chunkSize * numBlocksToWrite,
      );
      // Write to lowerDir (encrypted)
      this.lowerDir.writeSync(
        lowerFd,
        chunks,
        0,
        chunks.length,
        this.chunkNumToOffset(startChunkNum),
      );

      // ================== Handle and write metadata ================== //
      const newFileSize = position + length;

      if (newFileSize > this.getMetadata(fd).size) {
        this.getMetadata(fd).size = newFileSize;
        this.writeMetadataSync(fd);
      }

      this.writeMetaSync(filePath);

      return bufferBytesWritten;
    } catch (err) {
      if (err.errno) {
        throw new EncryptedFSError(
          {
            errno: err.errno,
            code: err.code,
            description: err.errnoDescription,
          },
          fd,
          null,
          err.syscall,
        );
      } else {
        throw err;
      }
    }
  }

  /**
   * Append data to a file, creating the file if it does not exist.
   * @param file string | number. Path to the file or directory.
   * @param data string | Buffer. The data to be appended.
   * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
   * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
   */
  appendFile(
    file: fs.PathLike | number,
    data: Buffer,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.appendFileSync.bind(this),
      [file, data, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously append data to a file, creating the file if it does not exist.
   * @param path string | number. Path to the file or directory.
   * @param data string | Buffer. The data to be appended.
   * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
   * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
   */
  appendFileSync(
    file: fs.PathLike | number,
    data: Buffer,
    options?: fs.WriteFileOptions,
  ): void {
    const optionsInternal = this.getFileOptions(
      { encoding: 'utf8', mode: 0o666, flag: 'a' },
      options,
    );
    let fd: number | null = null;
    try {
      // Get file descriptor
      if (typeof file === 'number') {
        fd = file;
      } else {
        fd = this.openSync(file, optionsInternal.flag, optionsInternal.mode);
      }
      const lowerFd = this.getLowerFd(fd);
      this.lowerDir.appendFileSync(lowerFd, data, optionsInternal);
    } catch (err) {
      if (err.errno) {
        throw new EncryptedFSError(
          {
            errno: err.errno,
            code: err.code,
            description: err.errnoDescription,
          },
          fd,
          null,
          err.syscall,
          EncryptedFSLayers.lower,
        );
      } else {
        throw err;
      }
    } finally {
      if (fd) {
        this.closeSync(fd);
      }
    }
  }

  /**
   * Changes the access permissions of the file system object described by path.
   * @param path Path to the fs object.
   * @param mode number. New permissions set.
   */
  chmod(path: fs.PathLike, mode: number = 0, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.chmodSync.bind(this),
      [path, mode, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously changes the access permissions of the file system object described by path.
   * @param path Path to the fs object.
   * @param mode number. New permissions set.
   */
  chmodSync(path: fs.PathLike, mode: number = 0): void {
    if (this.upperDir.existsSync(path)) {
      this.upperDir.chmodSync(
        path,
        (this.upperDir.statSync(path).mode & constants.S_IFMT) | mode,
      );
    } else {
      this.loadMetaSync(this.getMetaName(path));
      this.meta[this.getMetaName(path)].mode =
        (this.meta[this.getMetaName(path)].mode & constants.S_IFMT) | mode;
      this.setMetadata(path);
    }
    this.writeMetaSync(this.getMetaName(path));
  }

  /**
   * Changes the owner or group of the file system object described by path.
   * @param path Path to the fs object.
   * @param uid number. User identifier.
   * @param gid number. Group identifier.
   */
  chown(
    path: fs.PathLike,
    uid: number,
    gid: number,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.chownSync.bind(this),
      [path, uid, gid, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously changes the owner or group of the file system object described by path.
   * @param path Path to the fs object.
   * @param uid number. User identifier.
   * @param gid number. Group identifier.
   */
  chownSync(path: fs.PathLike, uid: number, gid: number): void {
    if (this.upperDir.existsSync(path)) {
      this.upperDir.chownSync(path, uid, gid);
    } else {
      this.loadMetaSync(this.getMetaName(path));
      this.meta[this.getMetaName(path)].uid = uid;
      this.meta[this.getMetaName(path)].gid = gid;
      this.setMetadata(path);
    }
    this.writeMetaSync(this.getMetaName(path));
  }

  /**
   * Writes data to the path specified with some FileOptions.
   * @param path string | number. Path to the file or directory.
   * @param data string | Buffer. The data to be written.
   * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined } | undefined
   */
  writeFile(
    path: fs.PathLike | number,
    data: string | Buffer,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.writeFileSync.bind(this),
      [path, data, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  /**
   * Synchronously writes data to the path specified with some FileOptions.
   * @param path string | number. Path to the file or directory.
   * @param data string | Buffer. Defines the data to be .
   * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
   * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
   */
  writeFileSync(
    path: fs.PathLike | number,
    data: string | Buffer,
    options: fs.WriteFileOptions = {},
  ): void {
    const optionsInternal = this.getFileOptions(
      { encoding: 'utf8', mode: DEFAULT_FILE_PERM, flag: 'w' },
      options,
    );
    let fd: number | null = null;
    try {
      const isUserFileDescriptor = this.isFileDescriptor(path);
      if (isUserFileDescriptor) {
        fd = path as number;
      } else if (typeof path === 'string') {
        fd = this.openSync(path, 'writeonly', optionsInternal.mode);
      } else {
        throw new EncryptedFSError(errno.EBADF, path, null, 'writeFileSync');
      }
      let offset = 0;
      if (typeof data === 'string') {
        data = Buffer.from(data);
      }
      let length = data.byteLength;

      // let position = /a/.test(flag) ? null : 0
      let position = 0;

      while (length > 0) {
        const written = this.writeSync(fd, data, offset, length, position);
        offset += written;
        length -= written;
        if (position !== null) {
          position += written;
        }
      }
    } catch (err) {
      if (err.errno) {
        throw new EncryptedFSError(
          {
            errno: err.errno,
            code: err.code,
            description: err.errnoDescription,
          },
          path,
          null,
          err.syscall,
        );
      } else {
        throw err;
      }
    } finally {
      if (fd) {
        this.closeSync(fd);
      }
    }
  }

  /**
   * Opens a file or directory and returns the file descriptor.
   * @param path Path to the file or directory.
   * @param flags Flags for read/write operations. Defaults to 'r'.
   * @param mode number. Read and write permissions. Defaults to 0o666.
   */
  open(path: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.openSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      (data) => callback(null, data),
      callback,
    );
    return;
  }

  /**
   * Synchronously opens a file or directory and returns the file descriptor.
   * @param path Path to the file or directory.
   * @param flags Flags for read/write operations. Defaults to 'r'.
   * @param mode number. Read and write permissions. Defaults to 0o666.
   */
  openSync(
    path: fs.PathLike,
    flags: number | string = 'r',
    mode: number | string = 0o666,
  ): number {
    let decide = false;
    let exists = false;
    if (flags === 'writeonly') {
      flags = 'w';
      decide = true;
    }
    try {
      const _path = utils.addSuffix(this.getPath(path));
      if (this.lowerDir.existsSync(`${this.lowerBasePath}/${_path}`)) {
        exists = true;
      }
      // Open on lowerDir
      let lowerFd = this.lowerDir.openSync(
        `${this.lowerBasePath}/${_path}`,
        flags,
        0o777,
      );
      // Check if a directory
      if (this.lowerDir.fstatSync(lowerFd).isFile()) {
        // Open with write permissions as well
        this.lowerDir.closeSync(lowerFd);
        if (decide) {
          lowerFd = this.lowerDir.openSync(
            `${this.lowerBasePath}/${_path}`,
            'w',
            0o777,
          );
        } else {
          // const lowerFlags = flags[0];
          const lowerFlags = flags[0] === 'w' ? 'w+' : 'r';
          lowerFd = this.lowerDir.openSync(
            `${this.lowerBasePath}/${_path}`,
            lowerFlags,
            0o777,
          );
        }
      }
      const upperFilePath = path.toString();
      // Need to make path if it doesn't exist already
      if (!this.upperDir.existsSync(upperFilePath)) {
        const upperFilePathDir = pathNode.dirname(upperFilePath);
        // mkdirp
        this.upperDir.mkdirpSync(upperFilePathDir);
        // create file if needed
        this.upperDir.closeSync(
          this.upperDir.openSync(upperFilePath, 'w', mode),
        );
      }
      // Open on upperDir
      const upperFd = this.upperDir.openSync(upperFilePath, flags, mode);
      if (!this.meta[this.getMetaName(path)]) {
        this.meta[this.getMetaName(path)] = this.upperDir.statSync(path);
        this.writeMetaSync(path);
      }

      const dirs = path.toString().split(pathNode.sep);
      let navPath = '';
      let counter = 1;
      for (const dir of dirs) {
        if (counter < dirs.length) {
          counter++;
          navPath += `${dir}/`;
          if (exists) {
            if (flags[0] == 'r') {
              this.accessSync(navPath, this.constants.X_OK);
            } else {
              this.accessSync(
                navPath,
                this.constants.R_OK | this.constants.X_OK,
              );
            }
          } else {
            this.accessSync(navPath, this.constants.W_OK);
          }
        }
      }
      if (flags[0] == 'r') {
        this.accessSync(path, constants.R_OK);
      } else if (flags[0] == 'w') {
        this.accessSync(path, constants.W_OK);
      } else {
        throw Error('Number Flag');
      }
      // Create efsFd
      const efsFd = new FileDescriptor(
        lowerFd,
        this.getMetaName(path),
        upperFd,
        flags.toString(),
      );
      this.fileDescriptors.set(upperFd, efsFd);

      // If file descriptor points to file, write metadata
      const isDirectory = this.fstatSync(upperFd)?.isDirectory();
      if (!isDirectory) {
        if (flags[0] === 'r') {
          this.loadMetadataSync(upperFd);
        } else if (flags[0] === 'w') {
          const hash = cryptoUtils.hash(this.masterKey);
          this.metadata[upperFd] = { keyHash: hash, size: 0 };
          this.writeMetadataSync(upperFd);
        }
      }
      return upperFd;
    } catch (err) {
      if (err.errno) {
        throw new EncryptedFSError(
          {
            errno: err.errno,
            code: err.code,
            description: err.errnoDescription,
          },
          path,
          null,
          err.syscall,
        );
      } else {
        throw err;
      }
    }
  }

  lchown(
    path: fs.PathLike,
    uid: number,
    gid: number,
    ...args: Array<any>
  ): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.lchownSync.bind(this),
      [path, uid, gid, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  lchownSync(path: fs.PathLike, uid: number, gid: number): void {
    if (this.upperDir.existsSync(path)) {
      this.upperDir.lchownSync(path, uid, gid);
    } else {
      this.loadMetaSync(this.getMetaName(path));
      this.meta[this.getMetaName(path)].uid = uid;
      this.meta[this.getMetaName(path)].gid = gid;
      this.setMetadata(path);
    }
    this.writeMetaSync(this.getMetaName(path));
  }

  lchmod(path: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.lchmodSync.bind(this),
      [path, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  lchmodSync(path: fs.PathLike, mode: number = 0): void {
    if (this.upperDir.existsSync(path)) {
      this.upperDir.lchmodSync(
        path,
        (this.upperDir.lstatSync(path).mode & constants.S_IFMT) | mode,
      );
    } else {
      this.loadMetaSync(this.getMetaName(path));
      this.meta[this.getMetaName(path)].mode =
        (this.meta[this.getMetaName(path)].mode & constants.S_IFMT) | mode;
      this.setMetadata(path);
    }
    this.writeMetaSync(this.getMetaName(path));
  }

  copyFile(src: fs.PathLike, dest: fs.PathLike, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    cbIndex = cbIndex >= 0 ? cbIndex : args.length;
    this._callAsync(
      this.copyFileSync.bind(this),
      [src, dest, ...args.slice(0, cbIndex)],
      callback,
      callback,
    );
    return;
  }

  copyFileSync(src: fs.PathLike, dest: fs.PathLike, flags: number = 0): void {
    this.lowerDir.copyFileSync(
      `${this.lowerBasePath}/${utils.addSuffix(src)}`,
      `${this.lowerBasePath}/${utils.addSuffix(dest)}`,
      flags,
    );
    this.lowerDir.copyFileSync(
      `${this.lowerBasePath}/${utils.getPathToMeta(src)}`,
      `${this.lowerBasePath}/${utils.getPathToMeta(dest)}`,
      flags,
    );
    if (this.upperDir.existsSync(src)) {
      this.upperDir.copyFileSync(src, dest, flags);
      this.meta[this.getMetaName(dest)] = this.upperDir.statSync(dest);
    } else {
      this.meta[this.getMetaName(dest)] = this.meta[this.getMetaName(src)];
    }
    this.writeMetaSync(this.getMetaName(src));
    this.writeMetaSync(this.getMetaName(dest));
  }

  Stats: any;
  Dirent: any;
  Dir: any;
  ReadStream: any;
  WriteStream: any;
  BigIntStats: any;

  /**
   * Get key used for encryption.
   */
  getKey(): Buffer | string {
    return this.masterKey;
  }

  // ============= HELPER FUNCTIONS ============= //
  private getFileOptions(
    defaultOptions: Record<string, any>,
    options?: fs.WriteFileOptions,
  ): { encoding?: string | null; mode?: string | number; flag?: string } {
    let optionsFinal: fs.WriteFileOptions = defaultOptions;
    if (typeof options === 'string') {
      if (!this.isCharacterEncoding(options)) {
        throw Error('Invalid encoding string');
      }
      return { ...defaultOptions, encoding: options };
    }
    if (options) {
      if (options.encoding) {
        if (this.isCharacterEncoding(options.encoding)) {
          optionsFinal = { ...optionsFinal, encoding: options.encoding };
        } else {
          throw Error('Invalid encoding string');
        }
      }
      if (options.flag) {
        optionsFinal = { ...optionsFinal, flag: options.flag };
      }
      if (options.mode) {
        optionsFinal = { ...optionsFinal, mode: options.mode };
      }
    }
    return optionsFinal;
  }

  private getStreamOptions(
    defaultOptions: optionsStream,
    options?: optionsStream,
  ): optionsStream {
    let optionsFinal: optionsStream = defaultOptions;
    if (typeof options === 'string') {
      if (!this.isCharacterEncoding(options)) {
        throw Error('Invalid encoding string');
      }
      return { ...defaultOptions, encoding: options };
    }
    if (options) {
      if (options.highWaterMark) {
        optionsFinal = {
          ...optionsFinal,
          highWaterMark: options.highWaterMark,
        };
      }
      if (options.flags) {
        optionsFinal = { ...optionsFinal, flags: options.flags };
      }
      if (options.encoding) {
        if (this.isCharacterEncoding(options.encoding)) {
          optionsFinal = { ...optionsFinal, encoding: options.encoding };
        } else {
          throw Error('Invalid encoding string');
        }
      }
      if (options.fd) {
        optionsFinal = { ...optionsFinal, fd: options.fd };
      }
      if (options.mode) {
        optionsFinal = { ...optionsFinal, mode: options.mode };
      }
      if (options.autoClose) {
        optionsFinal = { ...optionsFinal, autoClose: options.autoClose };
      }
      if (options.start) {
        optionsFinal = { ...optionsFinal, start: options.start };
      }
      if (options.end) {
        optionsFinal = { ...optionsFinal, end: options.end };
      }
    }
    return optionsFinal;
  }

  private isCharacterEncoding(
    encoding: string | null | undefined,
  ): encoding is BufferEncoding {
    if (encoding == null || encoding == undefined) {
      return false;
    }

    return [
      'ascii',
      'utf8',
      'utf-8',
      'utf16le',
      'ucs2',
      'ucs-2',
      'base64',
      'latin1',
      'binary',
      'hex',
    ].includes(encoding);
  }

  /**
   * Asynchronously reads the whole block that the position lies within.
   * @param fd File descriptor.
   * @param position Position of data required.
   */
  private async readBlock(fd: number, position: number): Promise<Buffer> {
    const blockBuf = Buffer.alloc(this.blockSize);
    // First check if its a new block or empty
    const metadata = this.getMetadata(fd);
    if (metadata.size == 0) {
      return blockBuf.fill(0);
    }
    // Read non-empty block
    const blockNum = this.offsetToBlockNum(position);
    const blockOffset = this.blockNumToOffset(blockNum);
    await utils.promisify(this.read.bind(this))(
      fd,
      blockBuf,
      0,
      this.blockSize,
      blockOffset,
    );

    return blockBuf;
  }

  /**
   * Synchronously reads the whole block that the position lies within.
   * @param fd File descriptor.
   * @param position Position of data required.
   */
  private readBlockSync(fd: number, position: number): Buffer {
    const blockBuf = Buffer.alloc(this.blockSize);
    // First check if its a new block or empty
    const metadata = this.getMetadata(fd);
    if (metadata.size == 0) {
      return blockBuf.fill(0);
    }
    // Read non-empty block
    const blockNum = this.offsetToBlockNum(position);
    const blockOffset = this.blockNumToOffset(blockNum);
    this.readSync(fd, blockBuf, 0, this.blockSize, blockOffset);

    return blockBuf;
  }

  /**
   * Asynchronously reads from disk the chunk containing the block that needs to be merged with new block
   * @param fd File descriptor.
   * @param newData Buffer containing the new data.
   * @param position Position of the insertion.
   */
  private async overlaySegment(
    fd: number,
    newData: Buffer,
    position: number,
  ): Promise<Buffer> {
    // 	case 1:  segment is aligned to start of block and ends at end of block      |<------->|
    // 	case 2:  segment is aligned to start-of-block but end before end-of-block   |<----->--|
    // 	case 3:  segment is not aligned to start and ends before end-of-block       |--<--->--|
    // 	case 4:  segment is not aligned to start-of-block and ends at end-of-block  |--<----->|
    //
    // 	Cases 3 and 4 are not possible when overlaying the last segment

    const writeOffset = this.getBoundaryOffset(position); // byte offset from where to start writing new data in the block

    // Optimization: skip read if newData is block size and position is writeOffset is 0
    if (writeOffset === 0 && newData.length === this.blockSize) {
      return newData;
    }

    // Make sure newData won't be written over block boundary
    if (writeOffset + newData.length > this.blockSize) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'overlaySegment');
    }

    // Read relevant block
    const originalBlock = await this.readBlock(fd, position);

    const isBlockStartAligned = writeOffset === 0;
    // Get the start slice if newData is not block start aligned
    let startSlice = Buffer.alloc(0);
    if (!isBlockStartAligned) {
      startSlice = originalBlock.slice(0, writeOffset);
    }

    // Any data reamining after new block
    const endSlice = originalBlock.slice(writeOffset + newData.length);

    // Patch up slices to create new block
    const newBlock = Buffer.concat([startSlice, newData, endSlice]);

    return newBlock;
  }

  /**
   * Synchronously Reads from disk the chunk containing the block that needs to be merged with new block
   * @param fd File descriptor.
   * @param newData Buffer containing the new data.
   * @param position Position of the insertion.
   */
  private overlaySegmentSync(
    fd: number,
    newData: Buffer,
    position: number,
  ): Buffer {
    const writeOffset = this.getBoundaryOffset(position); // byte offset from where to start writing new data in the block

    // Optimization: skip read if newData is block aligned and length is blockSize
    if (writeOffset === 0 && newData.length === this.blockSize) {
      return newData;
    }

    // Make sure newData won't be written over block boundary
    if (writeOffset + newData.length > this.blockSize) {
      throw new EncryptedFSError(errno.EINVAL, fd, null, 'overlaySegmentSync');
    }

    // Read relevant block
    const originalBlock = this.readBlockSync(fd, position);

    const isBlockStartAligned = writeOffset === 0;
    // Get the start slice if newData is not block start aligned
    let startSlice = Buffer.alloc(0);
    if (!isBlockStartAligned) {
      startSlice = originalBlock.slice(0, writeOffset);
    }

    // Any data reamining after new block
    const endSlice = originalBlock.slice(writeOffset + newData.length);

    // Patch up slices to create new block
    const newBlock = Buffer.concat([startSlice, newData, endSlice]);

    return newBlock;
  }

  /**
   * Gets the byte offset from the beginning of the block that position lies within
   * @param position: number. Position.
   */
  private getBoundaryOffset(position: number) {
    // Position can start from 0 but block size starts counting from 1
    // Compare apples to apples first and then subtract 1
    return ((position + 1) % this.blockSize) - 1;
  }

  /**
   * Checks if path is a file descriptor (number) or not (string).
   * @param path Path of file.
   */
  private isFileDescriptor(path: fs.PathLike | number): path is number {
    if (typeof path === 'number') {
      if (this.fileDescriptors.has(path)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Retrieves the upperFd from an efs fd index.
   * @param fdIndex File descriptor.
   */
  private getUpperFd(fdIndex: number): number {
    if (this.fileDescriptors.has(fdIndex)) {
      const efsFd = this.fileDescriptors.get(fdIndex);
      if (efsFd) {
        const upperFd = efsFd.getUpperFd();
        if (upperFd !== undefined || upperFd !== null) {
          return upperFd;
        } else {
          throw Error('efs file descriptor is undefined');
        }
      } else {
        throw Error('efs file descriptor is undefined');
      }
    } else {
      throw Error('efs file descriptor does not exist');
    }
  }

  /**
   * Retrieves the lowerFd from an efs fd index.
   * @param fdIndex File descriptor.
   */
  private getLowerFd(fdIndex: number): number {
    if (this.fileDescriptors.has(fdIndex)) {
      const efsFd = this.fileDescriptors.get(fdIndex);
      if (efsFd) {
        const lowerFd = efsFd.getLowerFd();
        if (lowerFd !== undefined || lowerFd !== null) {
          return lowerFd;
        } else {
          throw Error('efs file descriptor is undefined');
        }
      } else {
        throw Error('efs file descriptor is undefined');
      }
    } else {
      throw Error('efs file descriptor does not exist');
    }
  }

  private getMetaPath(fdIndex: number): string {
    if (this.fileDescriptors.has(fdIndex)) {
      const efsFd = this.fileDescriptors.get(fdIndex);
      if (efsFd) {
        const metaPath = efsFd.getMetaPath();
        if (metaPath !== undefined || metaPath !== null) {
          return metaPath;
        } else {
          throw Error('efs file descriptor is undefined');
        }
      } else {
        throw Error('efs file descriptor is undefined');
      }
    } else {
      throw Error('efs file descriptor does not exist');
    }
  }

  /**
   * Takes a position in a file and returns the block number that 'position' lies in.
   * @param position
   */
  private offsetToBlockNum(position: number): number {
    // we use blockSize as opposed to chunkSize because chunk contains metadata
    // transparent to user. When user specifies position it is as if it were plaintext
    return Math.floor(position / this.blockSize);
  }

  /**
   * Calculates the offset/position of the block number in the unencrypted file.
   * @param blockNum Block number.
   */
  private blockNumToOffset(blockNum: number): number {
    return blockNum * this.blockSize;
  }

  /**
   * Calculates the offset/position of the chunk number in the unencrypted file.
   * @param chunkNum Chunk number.
   */
  private chunkNumToOffset(chunkNum: number): number {
    return chunkNum * this.chunkSize;
  }

  /**
   * Creates a block generator for block iteration, split is per block length.
   * @param blocks Buffer containing blocks to be split.
   * @param blockSize Size of an individual block.
   */
  private *blockGenerator(
    blocks: Buffer,
    blockSize: number = this.blockSize,
  ): IterableIterator<Buffer> {
    let currOffset = 0;
    while (currOffset < blocks.length) {
      yield blocks.slice(currOffset, currOffset + blockSize);
      currOffset += blockSize;
    }
  }

  /**
   * Creates a chunk generator for chunk iteration, split is per block length.
   * @param chunks Buffer containing blocks to be split.
   * @param chunkSize Size of an individual block.
   */
  private *chunkGenerator(
    chunks: Buffer,
    chunkSize: number = this.chunkSize,
  ): IterableIterator<Buffer> {
    let currOffset = 0;
    while (currOffset < chunks.length) {
      yield chunks.slice(currOffset, currOffset + chunkSize);
      currOffset += chunkSize;
    }
  }

  /**
   * Synchronously checks if file (fd) contains conntent or not.
   * @param fd File descriptor.
   */
  private hasContentSync(fd: number): boolean {
    const hasContent = this.lowerDir.fstatSync(fd).size !== 0;
    return hasContent;
  }

  /**
   * Synchronously checks for file size.
   * @param fd File descriptor.
   */
  private getPostWriteFileSize(
    fd: number,
    position: number,
    length: number,
  ): number {
    const fileMeta = this.metadata[fd];
    const newSize = position + length;
    const fileSize = fileMeta.size;
    if (newSize > fileSize) {
      fileMeta.size = newSize;
      return newSize;
    } else {
      return fileSize;
    }
  }

  private writeMetaSync(path: fs.PathLike | string): void {
    let dir = pathNode.dirname(path.toString());
    if (dir == '.') {
      dir = '';
    } else {
      dir = utils.addSuffix(dir);
    }
    const file = pathNode.basename(path.toString());
    const metadata = this.meta[this.getMetaName(path)];
    const serialMeta = JSON.stringify(metadata);
    const metadataBlockBuffer = Buffer.concat(
      [Buffer.from(serialMeta)],
      this.blockSize,
    );
    const metadataChunkBuffer = cryptoUtils.encryptBlock(
      this.masterKey,
      metadataBlockBuffer,
    );
    this.lowerDir.writeFileSync(
      `${this.lowerBasePath}/${dir}/.${file}.meta`,
      metadataChunkBuffer,
    );
  }

  private async writeMeta(path: fs.PathLike | string): Promise<void> {
    let dir = pathNode.dirname(path.toString());
    if (dir == '.') {
      dir = '';
    } else {
      dir = utils.addSuffix(dir);
    }
    const file = pathNode.basename(path.toString());
    const metadata = this.meta[this.getMetaName(path)];
    const serialMeta = JSON.stringify(metadata);
    const metadataBlockBuffer = Buffer.concat(
      [Buffer.from(serialMeta)],
      this.blockSize,
    );
    let metaChunkBuffer;
    if (this.workerManager) {
      metaChunkBuffer = await this.workerManager.call(async (w) => {
        const retBuf = await w.encryptBlock(
          this.masterKey.toString('binary'),
          metadataBlockBuffer.toString('binary'),
        );
        if (retBuf) {
          return Buffer.from(retBuf);
        }
      });
    } else {
      metaChunkBuffer = cryptoUtils.encryptBlock(
        this.masterKey,
        metadataBlockBuffer,
      );
    }
    this.lowerDir.writeFileSync(
      `${this.lowerBasePath}/${dir}/.${file}.meta`,
      metaChunkBuffer,
    );
  }

  private async loadMeta(path: fs.PathLike | string): Promise<void> {
    let dir = pathNode.dirname(path.toString());
    dir = utils.addSuffix(dir);
    const file = pathNode.basename(path.toString());
    const metaChunkBuffer = this.lowerDir.readFileSync(
      `${this.lowerBasePath}/${dir}/.${file}.meta`,
    );
    let metaBlock;
    if (this.workerManager) {
      metaBlock = await this.workerManager.call(async (w) => {
        const retBuf = await w.decryptChunk(
          this.masterKey.toString('binary'),
          metaChunkBuffer.toString('binary'),
        );
        if (retBuf) {
          return Buffer.from(retBuf);
        }
      });
    } else {
      metaBlock = cryptoUtils.decryptChunk(this.masterKey, metaChunkBuffer);
    }
    if (!metaBlock) {
      throw Error('Metadata decryption unsuccessful');
    }
    const metaPlainTrimmed = metaBlock.slice(0, metaBlock.indexOf('\0'));
    const fileMeta = JSON.parse(metaPlainTrimmed.toString());
    this.meta[this.getMetaName(path)] = fileMeta;
  }

  private loadMetaSync(path: fs.PathLike | string): void {
    let dir = pathNode.dirname(path.toString());
    dir = utils.addSuffix(dir);
    const file = pathNode.basename(path.toString());
    const metaChunkBuffer = this.lowerDir.readFileSync(
      `${this.lowerBasePath}/${dir}/.${file}.meta`,
    );
    const metaBlock = cryptoUtils.decryptChunk(this.masterKey, metaChunkBuffer);
    if (!metaBlock) {
      throw Error('Metadata decryption unsuccessful');
    }

    const metaPlainTrimmed = metaBlock.slice(0, metaBlock.indexOf('\0'));
    const fileMeta = JSON.parse(metaPlainTrimmed.toString());
    this.meta[this.getMetaName(path)] = fileMeta;
  }

  private writeMetadataSync(fd: number): void {
    const metadata = this.getMetadata(fd);
    const serialMeta = JSON.stringify(metadata);
    const metadataBlockBuffer = Buffer.concat(
      [Buffer.from(serialMeta)],
      this.blockSize,
    );
    const metadataChunkBuffer = cryptoUtils.encryptBlock(
      this.masterKey,
      metadataBlockBuffer,
    );
    const metadataOffset = this.getMetadataOffsetSync(fd);
    this.lowerDir.writeSync(
      this.getLowerFd(fd),
      metadataChunkBuffer,
      0,
      metadataChunkBuffer.length,
      metadataOffset,
    );
  }

  private async writeMetadata(fd: number): Promise<void> {
    const metadata = this.getMetadata(fd);
    const serialMeta = JSON.stringify(metadata);
    const metadataBlockBuffer = Buffer.concat(
      [Buffer.from(serialMeta)],
      this.blockSize,
    );
    let metadataChunkBuffer;
    if (this.workerManager) {
      metadataChunkBuffer = await this.workerManager.call(async (w) => {
        const retBuf = await w.encryptBlock(
          this.masterKey.toString('binary'),
          metadataBlockBuffer.toString('binary'),
        );
        if (retBuf) {
          return Buffer.from(retBuf);
        }
      });
    } else {
      metadataChunkBuffer = cryptoUtils.encryptBlock(
        this.masterKey,
        metadataBlockBuffer,
      );
    }
    const metadataOffset = this.getMetadataOffsetSync(fd);
    const writeAsync = utils.promisify(this.lowerDir.write).bind(this.lowerDir);
    writeAsync(
      this.getLowerFd(fd),
      metadataChunkBuffer,
      0,
      metadataChunkBuffer.length,
      metadataOffset,
    );
  }

  private async loadMetadata(fd: number): Promise<void> {
    const metaChunk = Buffer.alloc(this.chunkSize);
    const metaChunkOffset = this.getMetadataOffsetSync(fd);
    const readAsync = utils.promisify(this.lowerDir.read).bind(this.lowerDir);
    await readAsync(
      this.getLowerFd(fd),
      metaChunk,
      0,
      metaChunk.length,
      metaChunkOffset,
    );
    let metaBlock;
    if (this.workerManager) {
      metaBlock = await this.workerManager.call(async (w) => {
        const retBuf = await w.decryptChunk(
          this.masterKey.toString('binary'),
          metaChunk.toString('binary'),
        );
        if (retBuf) {
          return Buffer.from(retBuf);
        }
      });
    } else {
      metaBlock = cryptoUtils.decryptChunk(this.masterKey, metaChunk);
    }
    const metaPlainTrimmed = metaBlock.slice(0, metaBlock.indexOf('\0'));
    const fileMeta = eval('(' + metaPlainTrimmed.toString('binary') + ')');
    this.metadata[fd] = fileMeta;
  }

  private loadMetadataSync(fd: number): void {
    const metaChunk = Buffer.alloc(this.chunkSize);
    const metaChunkOffset = this.getMetadataOffsetSync(fd);
    this.lowerDir.readSync(
      this.getLowerFd(fd),
      metaChunk,
      0,
      metaChunk.length,
      metaChunkOffset,
    );
    const metaBlock = cryptoUtils.decryptChunk(this.masterKey, metaChunk);
    if (!metaBlock) {
      throw Error('Metadata decryption unsuccessful');
    }
    const metaPlainTrimmed = metaBlock.slice(0, metaBlock.indexOf('\0'));

    const fileMeta = eval('(' + metaPlainTrimmed.toString() + ')');
    this.metadata[fd] = fileMeta;
  }

  private getMetadata(fd: number): UpperDirectoryMetadata {
    if (Object.prototype.hasOwnProperty.call(this.metadata, fd)) {
      const fileMeta = this.metadata[fd];
      if (fileMeta) {
        return fileMeta;
      }
    }
    throw Error('file descriptor has no metadata stored');
  }

  private setMetadata(path: fs.PathLike | number): void {
    let fd: number;
    let _path: fs.PathLike;
    if (typeof path != 'number') {
      _path = path;
      fd = this.upperDir.openSync(path, 'w');
    } else {
      fd = path;
      _path = this.getMetaPath(fd);
    }
    if (!this.meta[this.getMetaName(_path)]) {
      throw new EncryptedFSError(
        errno.ENOENT,
        this.getMetaName(_path),
        null,
        'setMetadata',
      );
    }
    this.fdManager.getFd(fd).getINode()._metadata = this.meta[
      this.getMetaName(_path)
    ];
  }

  private getMetadataOffsetSync(fd: number): number {
    const efsFd = this.getEfsFd(fd);
    const stats = this.lowerDir.fstatSync(this.getLowerFd(fd));
    const size = stats.size;
    if (efsFd.getFlags()[0] === 'w') {
      return size;
    }

    const numBlocks = size / this.chunkSize;
    return this.chunkNumToOffset(numBlocks - 1);
  }

  private getEfsFd(fd: number): FileDescriptor {
    if (this.fileDescriptors.has(fd)) {
      const efsFd = this.fileDescriptors.get(fd);
      if (efsFd) {
        return efsFd;
      }
    }

    throw Error('file descriptor has no metadata stored');
  }

  /**
   * Processes path types and collapses it to a string.
   * The path types can be string or Buffer or URL.
   * @private
   */
  private getPath(path: fs.PathLike): string {
    if (typeof path === 'string') {
      return path;
    }
    if (path instanceof Buffer) {
      return path.toString();
    }
    if (path instanceof URL) {
      return this.getPathFromURL(path);
    }
    throw new TypeError('path must be a string or Buffer or URL');
  }

  /**
   * Acquires the file path from an URL object.
   * @private
   */
  private getPathFromURL(url: { pathname: string } | URL): string {
    if (Object.prototype.hasOwnProperty.call(url, 'hostname')) {
      throw new TypeError('ERR_INVALID_FILE_URL_HOST');
    }
    const pathname = url.pathname;
    if (pathname.match(/%2[fF]/)) {
      // must not allow encoded slashes
      throw new TypeError('ERR_INVALID_FILE_URL_PATH');
    }
    return decodeURIComponent(pathname);
  }

  private getMetaName(path: fs.PathLike): string {
    const _path = path.toString();
    const normalPath = pathNode.normalize(_path);
    let dir = pathNode.dirname(normalPath);
    const base = pathNode.basename(normalPath);
    if (dir == '.') {
      dir = '';
    } else {
      dir += '/';
    }
    if (base == '.') {
      if (dir == '') {
        throw new EncryptedFSError(errno.ENOENT, path, null, 'getmeta');
      } else {
        return dir;
      }
    }
    let ret = pathNode.normalize(`${dir}${base}`);
    if (ret[0] == '/') {
      ret = ret.substring(1);
    }
    return ret;
  }

  private _callAsync(
    syncFn: any,
    args: Array<any>,
    successCall: any,
    failCall: any,
  ) {
    nextTick(() => {
      try {
        let result = syncFn(...args);
        result = result === undefined ? null : result;
        successCall(result);
      } catch (e) {
        failCall(e);
      }
    });
    return;
  }
}

export default EncryptedFS;
