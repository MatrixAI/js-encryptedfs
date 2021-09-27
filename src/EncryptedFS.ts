import type {
  Navigated,
  ParsedPath,
  Callback,
  Path,
  Options,
  Data,
  File,
  EFSWorkerManagerInterface,
} from './types';
import type { INodeIndex } from './inodes';
import type { FdIndex } from './fd';
import type { OptionsStream } from './streams';

import { code as errno } from 'errno';
import Logger from '@matrixai/logger';
import { DB } from '@matrixai/db';
import CurrentDirectory from './CurrentDirectory';
import Stat from './Stat';
import { INodeManager, errors as inodesErrors } from './inodes';
import { FileDescriptor, FileDescriptorManager } from './fd';
import { ReadStream, WriteStream } from './streams';
import * as constants from './constants';
import * as permissions from './permissions';
import * as utils from './utils';
import * as errors from './errors';

class EncryptedFS {
  public static async createEncryptedFS({
    dbPath,
    dbKey,
    iNodeMgr,
    fdMgr,
    blockSize,
    umask,
    logger,
  }: {
    dbPath: string;
    dbKey: Buffer;
    iNodeMgr?: INodeManager;
    fdMgr?: FileDescriptorManager;
    blockSize?: number;
    umask?: number;
    logger?: Logger;
  }): Promise<EncryptedFS>;
  public static async createEncryptedFS({
    db,
    iNodeMgr,
    fdMgr,
    blockSize,
    umask,
    logger,
  }: {
    db: DB;
    iNodeMgr?: INodeManager;
    fdMgr?: FileDescriptorManager;
    blockSize?: number;
    umask?: number;
    logger?: Logger;
  }): Promise<EncryptedFS>;
  public static async createEncryptedFS({
    dbPath,
    dbKey,
    db,
    iNodeMgr,
    fdMgr,
    blockSize = 4096,
    umask = 0o022,
    logger = new Logger(EncryptedFS.name),
  }: {
    dbPath?: string;
    dbKey?: Buffer;
    db?: DB;
    iNodeMgr?: INodeManager;
    fdMgr?: FileDescriptorManager;
    blockSize?: number;
    umask?: number;
    logger?: Logger;
  }): Promise<EncryptedFS> {
    if (db == null) {
      db = await DB.createDB({
        dbPath: dbPath!,
        crypto: {
          key: dbKey!,
          ops: {
            encrypt: utils.encrypt,
            decrypt: utils.decrypt,
          },
        },
        logger: logger.getChild(DB.name),
      });
    }
    iNodeMgr =
      iNodeMgr ??
      (await INodeManager.createINodeManager({
        db,
        logger: logger.getChild(INodeManager.name),
      }));
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(
      async (tran) => {
        tran.queueFailure(() => {
          if (!iNodeMgr) throw Error;
          iNodeMgr.inoDeallocate(rootIno);
        });
        await iNodeMgr!.dirCreate(tran, rootIno, {
          mode: permissions.DEFAULT_ROOT_PERM,
          uid: permissions.DEFAULT_ROOT_UID,
          gid: permissions.DEFAULT_ROOT_GID,
        });
      },
      [rootIno],
    );
    fdMgr = fdMgr ?? new FileDescriptorManager(iNodeMgr);
    const efs = new EncryptedFS({
      db,
      iNodeMgr,
      fdMgr,
      rootIno,
      blockSize,
      umask,
      logger,
    });
    await efs.start();
    return efs;
  }

  public uid: number;
  public gid: number;
  public umask: number;
  public readonly blockSize: number;

  protected db: DB;
  protected iNodeMgr: INodeManager;
  protected fdMgr: FileDescriptorManager;
  protected logger: Logger;
  protected rootIno: INodeIndex;
  protected _cwd: CurrentDirectory;
  protected _running: boolean = false;
  protected _destroyed: boolean = false;

  protected constructor({
    db,
    iNodeMgr,
    fdMgr,
    rootIno,
    blockSize,
    umask,
    logger,
  }: {
    db: DB;
    iNodeMgr: INodeManager;
    fdMgr: FileDescriptorManager;
    rootIno: INodeIndex;
    blockSize: number;
    umask: number;
    logger: Logger;
  }) {
    this.logger = logger;
    this.uid = permissions.DEFAULT_ROOT_UID;
    this.gid = permissions.DEFAULT_ROOT_GID;
    this.umask = umask;
    this.blockSize = blockSize;
    this.db = db;
    this.iNodeMgr = iNodeMgr;
    this.fdMgr = fdMgr;
    this.rootIno = rootIno;
    this._cwd = new CurrentDirectory(iNodeMgr, rootIno);
  }

  get cwd() {
    return this._cwd.path;
  }

  get running(): boolean {
    return this._running;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  get promises() {
    return this;
  }

  public async start(): Promise<void> {
    try {
      if (this._running) {
        return;
      }
      if (this._destroyed) {
        throw new errors.ErrorEncryptedFSDestroyed();
      }
      this.logger.info('Starting EncryptedFS');
      this._running = true;
      await this.db.start();
      this.logger.info('Started EncryptedFS');
    } catch (e) {
      this._running = false;
      throw e;
    }
  }

  public async stop(): Promise<void> {
    try {
      if (!this._running) {
        return;
      }
      this.logger.info('Stopping EncryptedFS');
      this._running = false;
      await this.db.stop();
      this.logger.info('Stopped EncryptedFS');
    } catch (e) {
      this._running = true;
      throw e;
    }
  }

  public async destroy(): Promise<void> {
    try {
      if (this._destroyed) {
        return;
      }
      if (this._running) {
        throw new errors.ErrorEncryptedFSRunning();
      }
      this.logger.info('Destroying EncryptedFS');
      this._destroyed = true;
      await this.db.destroy();
      this.logger.info('Destroyed EncryptedFS');
    } catch (e) {
      this._destroyed = false;
      throw e;
    }
  }

  public setWorkerManager(workerManager: EFSWorkerManagerInterface) {
    this.db.setWorkerManager(workerManager);
  }

  public unsetWorkerManager() {
    this.db.unsetWorkerManager();
  }

  public async chroot(path: string): Promise<EncryptedFS>;
  public async chroot(
    path: string,
    callback: Callback<[EncryptedFS]>,
  ): Promise<void>;
  public async chroot(
    path: string,
    callback?: Callback<[EncryptedFS]>,
  ): Promise<EncryptedFS | void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const navigated = await this.navigate(path, true);
      const target = navigated.target;
      if (!target) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
        });
      }
      await this.iNodeMgr.transact(
        async (tran) => {
          const targetType = (await this.iNodeMgr.get(tran, target))?.type;
          const targetStat = await this.iNodeMgr.statGet(tran, target);
          if (!(targetType === 'Directory')) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOTDIR,
              path: path as string,
            });
          }
          if (!this.checkPermissions(constants.X_OK, targetStat)) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EACCES,
              path: path as string,
            });
          }
        },
        target ? [target] : [],
      );
      return new EncryptedFS({
        db: this.db,
        iNodeMgr: this.iNodeMgr,
        fdMgr: this.fdMgr,
        rootIno: target,
        blockSize: this.blockSize,
        umask: this.umask,
        logger: this.logger,
      });
    }, callback);
  }

  public async chdir(path: string): Promise<void>;
  public async chdir(path: string, callback: Callback): Promise<void>;
  public async chdir(path: string, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const navigated = await this.navigate(path, true);
      const target = navigated.target;
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!target) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
            });
          }
          const targetType = (await this.iNodeMgr.get(tran, target))?.type;
          const targetStat = await this.iNodeMgr.statGet(tran, target);
          if (!(targetType === 'Directory')) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOTDIR,
              path: path as string,
            });
          }
          if (!this.checkPermissions(constants.X_OK, targetStat)) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EACCES,
              path: path as string,
            });
          }
          await this._cwd.changeDir(target, navigated.pathStack);
        },
        target ? [target] : [],
      );
    }, callback);
  }

  public async access(path: Path, mode?: number): Promise<void>;
  public async access(path: Path, callback: Callback): Promise<void>;
  public async access(
    path: Path,
    mode: number,
    callback: Callback,
  ): Promise<void>;
  public async access(
    path: Path,
    modeOrCallback: number | Callback = constants.F_OK,
    callback?: Callback,
  ): Promise<void> {
    const mode =
      typeof modeOrCallback !== 'function' ? modeOrCallback : constants.F_OK;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      await this.iNodeMgr.transact(async (tran) => {
        if (!target) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'access',
          });
        }
        if (mode === constants.F_OK) {
          return;
        }
        const targetStat = await this.iNodeMgr.statGet(tran, target);
        if (!this.checkPermissions(mode, targetStat)) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.EACCES,
            path: path as string,
            syscall: 'access',
          });
        }
      });
    }, callback);
  }

  public async appendFile(
    file: Path | FdIndex,
    data: Data,
    options?: Options,
  ): Promise<void>;
  public async appendFile(
    file: Path | FdIndex,
    data: Data,
    callback: Callback,
  ): Promise<void>;
  public async appendFile(
    file: Path | FdIndex,
    data: Data,
    options: Options,
    callback: Callback,
  ): Promise<void>;
  public async appendFile(
    file: Path | FdIndex,
    data: Data = 'undefined',
    optionsOrCallback: Options | Callback = {
      encoding: 'utf8',
      mode: permissions.DEFAULT_FILE_PERM,
      flag: 'a',
    },
    callback?: Callback,
  ): Promise<void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? this.getOptions(
            {
              encoding: 'utf8' as BufferEncoding,
              mode: permissions.DEFAULT_FILE_PERM,
            },
            optionsOrCallback,
          )
        : ({
            encoding: 'utf8',
            mode: permissions.DEFAULT_FILE_PERM,
          } as Options);
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      options.flag = 'a';
      data = this.getBuffer(data, options.encoding);
      let fdIndex;
      try {
        let fd;
        if (typeof file === 'number') {
          fd = this.fdMgr.getFd(file);
          if (!fd)
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              syscall: 'appendFile',
            });
          if (!(fd.flags & (constants.O_WRONLY | constants.O_RDWR))) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              syscall: 'appendFile',
            });
          }
        } else {
          [fd, fdIndex] = await this._open(
            file as Path,
            options.flag,
            options.mode,
          );
        }
        try {
          await fd.write(data, undefined, constants.O_APPEND);
        } catch (e) {
          if (e instanceof RangeError) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EFBIG,
              syscall: 'appendFile',
            });
          }
          throw e;
        }
      } finally {
        if (fdIndex !== undefined) await this.close(fdIndex);
      }
      return;
    }, callback);
  }

  public async chmod(
    path: Path,
    mode: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!target) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'chmod',
            });
          }
          const targetStat = await this.iNodeMgr.statGet(tran, target);
          if (
            this.uid !== permissions.DEFAULT_ROOT_UID &&
            this.uid !== targetStat.uid
          ) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EPERM,
              path: path as string,
              syscall: 'chmod',
            });
          }
          await this.iNodeMgr.statSetProp(
            tran,
            target,
            'mode',
            (targetStat.mode & constants.S_IFMT) | mode,
          );
        },
        target ? [target] : [],
      );
    }, callback);
  }

  public async chown(
    path: Path,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!target) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'chown',
            });
          }
          const targetStat = await this.iNodeMgr.statGet(tran, target);
          if (this.uid !== permissions.DEFAULT_ROOT_UID) {
            // You don't own the file
            if (targetStat.uid !== this.uid) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EPERM,
                path: path as string,
                syscall: 'chown',
              });
            }
            // You cannot give files to others
            if (this.uid !== uid) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EPERM,
                path: path as string,
                syscall: 'chown',
              });
            }
            // Because we don't have user group hierarchies, we allow chowning to any group
          }
          await this.iNodeMgr.statSetProp(tran, target, 'uid', uid);
          await this.iNodeMgr.statSetProp(tran, target, 'gid', gid);
        },
        target ? [target] : [],
      );
    }, callback);
  }

  public async chownr(
    path: Path,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      await this.chown(path, uid, gid);
      let children;
      try {
        children = await this.readdir(path);
      } catch (e) {
        if (e && e.code === 'ENOTDIR') return;
        throw e;
      }
      for (const child of children) {
        const pathChild = utils.pathJoin(path as string, child);
        // Don't traverse symlinks
        if (!(await this.lstat(pathChild)).isSymbolicLink()) {
          await this.chownr(pathChild, uid, gid);
        }
      }
    }, callback);
  }

  public async close(fdIndex: FdIndex, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      if (!this.fdMgr.getFd(fdIndex)) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'close',
        });
      }
      await this.fdMgr.deleteFd(fdIndex);
    }, callback);
  }

  public async copyFile(
    srcPath: Path,
    dstPath: Path,
    flags?: number,
  ): Promise<void>;
  public async copyFile(
    srcPath: Path,
    dstPath: Path,
    callback: Callback,
  ): Promise<void>;
  public async copyFile(
    srcPath: Path,
    dstPath: Path,
    flags: number,
    callback: Callback,
  ): Promise<void>;
  public async copyFile(
    srcPath: Path,
    dstPath: Path,
    flagsOrCallback: number | Callback = 0,
    callback?: Callback,
  ): Promise<void> {
    const flags = typeof flagsOrCallback !== 'function' ? flagsOrCallback : 0;
    callback =
      typeof flagsOrCallback === 'function' ? flagsOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      srcPath = this.getPath(srcPath);
      dstPath = this.getPath(dstPath);
      let srcFd, srcFdIndex, dstFd, dstFdIndex;
      try {
        // The only things that are copied is the data and the mode
        [srcFd, srcFdIndex] = await this._open(srcPath, constants.O_RDONLY);
        const srcINode = srcFd.ino;
        await this.iNodeMgr.transact(async (tran) => {
          tran.queueFailure(() => {
            this.iNodeMgr.inoDeallocate(dstINode);
          });
          const srcINodeType = (await this.iNodeMgr.get(tran, srcINode))?.type;
          const srcINodeStat = await this.iNodeMgr.statGet(tran, srcINode);
          if (srcINodeType === 'Directory') {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              path: srcPath as string,
              dest: dstPath as string,
              syscall: 'copyFile',
            });
          }
          let dstFlags = constants.O_WRONLY | constants.O_CREAT;
          if (flags & constants.COPYFILE_EXCL) {
            dstFlags |= constants.O_EXCL;
          }
          [dstFd, dstFdIndex] = await this._open(
            dstPath,
            dstFlags,
            srcINodeStat.mode,
          );
          const dstINode = dstFd.ino;
          const dstINodeType = (await this.iNodeMgr.get(tran, dstINode))?.type;
          if (dstINodeType === 'File') {
            let blkCounter = 0;
            for await (const block of this.iNodeMgr.fileGetBlocks(
              tran,
              srcINode,
              this.blockSize,
            )) {
              await this.iNodeMgr.fileSetBlocks(
                tran,
                dstFd.ino,
                block,
                this.blockSize,
                blkCounter,
              );
              blkCounter++;
            }
          } else {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EINVAL,
              path: srcPath as string,
              dest: dstPath as string,
              syscall: 'copyFile',
            });
          }
        });
      } finally {
        if (srcFdIndex !== undefined) await this.close(srcFdIndex);
        if (dstFdIndex !== undefined) await this.close(dstFdIndex);
      }
    }, callback);
  }

  public async createReadStream(
    path: Path,
    options?: OptionsStream,
  ): Promise<ReadStream>;
  public async createReadStream(
    path: Path,
    callback: Callback<[ReadStream]>,
  ): Promise<void>;
  public async createReadStream(
    path: Path,
    options: OptionsStream,
    callback: Callback<[ReadStream]>,
  ): Promise<void>;
  public async createReadStream(
    path: Path,
    optionsOrCallback: OptionsStream | Callback<[ReadStream]> = {},
    callback?: Callback<[ReadStream]>,
  ): Promise<ReadStream | void> {
    const defaultOps: OptionsStream = {
      flags: 'r',
      encoding: undefined,
      fd: undefined,
      mode: permissions.DEFAULT_FILE_PERM,
      autoClose: true,
      end: Infinity,
    };
    const options =
      typeof optionsOrCallback !== 'function'
        ? (this.getOptions(defaultOps, optionsOrCallback) as OptionsStream)
        : defaultOps;
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      if (options.start !== undefined) {
        if (options.start > (options.end ?? Infinity)) {
          throw new RangeError('ERR_VALUE_OUT_OF_RANGE');
        }
      }
      return new ReadStream(path, options, this);
    }, callback);
  }

  public async createWriteStream(
    path: Path,
    options?: OptionsStream,
  ): Promise<WriteStream>;
  public async createWriteStream(
    path: Path,
    callback: Callback<[WriteStream]>,
  ): Promise<void>;
  public async createWriteStream(
    path: Path,
    options: OptionsStream,
    callback: Callback<[WriteStream]>,
  ): Promise<void>;
  public async createWriteStream(
    path: Path,
    optionsOrCallback: OptionsStream | Callback<[WriteStream]> = {},
    callback?: Callback<[WriteStream]>,
  ): Promise<WriteStream | void> {
    const defaultOps: OptionsStream = {
      flags: 'w',
      encoding: 'utf8',
      fd: undefined,
      mode: permissions.DEFAULT_FILE_PERM,
      autoClose: true,
    };
    const options =
      typeof optionsOrCallback !== 'function'
        ? (this.getOptions(defaultOps, optionsOrCallback) as OptionsStream)
        : defaultOps;
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      if (options.start !== undefined) {
        if (options.start < 0) {
          throw new RangeError('ERR_VALUE_OUT_OF_RANGE');
        }
      }
      return new WriteStream(path, options, this);
    }, callback);
  }

  public async exists(
    path: Path,
    callback?: Callback<[boolean]>,
  ): Promise<boolean | void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      try {
        return !!(await this.navigate(path, true)).target;
      } catch (e) {
        return false;
      }
    }, callback);
  }

  public async fallocate(
    fdIndex: FdIndex,
    offset: number,
    len: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      if (offset < 0 || len <= 0) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EINVAL,
          syscall: 'fallocate',
        });
      }
      const fd = this.fdMgr.getFd(fdIndex);
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!fd) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              syscall: 'fallocate',
            });
          }
          const iNodeType = (await this.iNodeMgr.get(tran, fd.ino))?.type;
          if (!(iNodeType === 'File')) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENODEV,
              syscall: 'fallocate',
            });
          }
          if (!(fd.flags & (constants.O_WRONLY | constants.O_RDWR))) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              syscall: 'fallocate',
            });
          }
          const data = Buffer.alloc(0);
          if (offset + len > data.length) {
            const [index, data] = await this.iNodeMgr.fileGetLastBlock(
              tran,
              fd.ino,
            );
            let newData;
            try {
              newData = Buffer.concat([
                data,
                Buffer.alloc(offset + len - data.length),
              ]);
            } catch (e) {
              if (e instanceof RangeError) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.EFBIG,
                  syscall: 'fallocate',
                });
              }
              throw e;
            }
            await this.iNodeMgr.fileSetBlocks(
              tran,
              fd.ino,
              newData,
              this.blockSize,
              index,
            );
            await this.iNodeMgr.statSetProp(
              tran,
              fd.ino,
              'size',
              newData.length,
            );
          }
          await this.iNodeMgr.statSetProp(tran, fd.ino, 'ctime', new Date());
        },
        fd ? [fd.ino] : [],
      );
    }, callback);
  }

  public async fchmod(
    fdIndex: FdIndex,
    mode: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      const fd = this.fdMgr.getFd(fdIndex);
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!fd) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              syscall: 'fchmod',
            });
          }
          const fdStat = await this.iNodeMgr.statGet(tran, fd.ino);
          if (
            this.uid !== permissions.DEFAULT_ROOT_UID &&
            this.uid !== fdStat.uid
          ) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EPERM,
              syscall: 'fchmod',
            });
          }
          await this.iNodeMgr.statSetProp(
            tran,
            fd.ino,
            'mode',
            (fdStat.mode & constants.S_IFMT) | mode,
          );
        },
        fd ? [fd.ino] : [],
      );
    }, callback);
  }

  public async fchown(
    fdIndex: FdIndex,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      const fd = this.fdMgr.getFd(fdIndex);
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!fd) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              syscall: 'fchown',
            });
          }
          const fdStat = await this.iNodeMgr.statGet(tran, fd.ino);
          if (this.uid !== permissions.DEFAULT_ROOT_UID) {
            // You don't own the file
            if (fdStat.uid !== this.uid) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EPERM,
                syscall: 'fchown',
              });
            }
            // You cannot give files to others
            if (this.uid !== uid) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EPERM,
                syscall: 'fchown',
              });
            }
            // Because we don't have user group hierarchies, we allow chowning to any group
          }
          await this.iNodeMgr.statSetProp(tran, fd.ino, 'uid', uid);
          await this.iNodeMgr.statSetProp(tran, fd.ino, 'gid', gid);
        },
        fd ? [fd.ino] : [],
      );
    }, callback);
  }

  public async fdatasync(fdIndex: FdIndex, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      if (!this.fdMgr.getFd(fdIndex)) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'fdatasync',
        });
      }
    }, callback);
  }

  public async fstat(fdIndex: FdIndex): Promise<Stat>;
  public async fstat(
    fdIndex: FdIndex,
    callback: Callback<[Stat]>,
  ): Promise<void>;
  public async fstat(
    fdIndex: FdIndex,
    callback?: Callback<[Stat]>,
  ): Promise<Stat | void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      const fd = this.fdMgr.getFd(fdIndex);
      let fdStat;
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!fd) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              syscall: 'fstat',
            });
          }
          fdStat = await this.iNodeMgr.statGet(tran, fd.ino);
        },
        fd ? [fd.ino] : [],
      );
      return new Stat(fdStat);
    }, callback);
  }

  public async fsync(fdIndex: FdIndex, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      if (!this.fdMgr.getFd(fdIndex)) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'fsync',
        });
      }
    }, callback);
  }

  public async ftruncate(fdIndex: FdIndex, len?: number): Promise<void>;
  public async ftruncate(fdIndex: FdIndex, callback: Callback): Promise<void>;
  public async ftruncate(
    fdIndex: FdIndex,
    len: number,
    callback: Callback,
  ): Promise<void>;
  public async ftruncate(
    fdIndex: FdIndex,
    lenOrCallback: number | Callback = 0,
    callback?: Callback,
  ): Promise<void> {
    const len = typeof lenOrCallback !== 'function' ? lenOrCallback : 0;
    callback = typeof lenOrCallback === 'function' ? lenOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      if (len < 0) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EINVAL,
          syscall: 'ftruncate',
        });
      }
      let newData;
      const fd = this.fdMgr.getFd(fdIndex);
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!fd) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              syscall: 'ftruncate',
            });
          }
          const iNodeType = (await this.iNodeMgr.get(tran, fd.ino))?.type;
          if (!(iNodeType === 'File')) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EINVAL,
              syscall: 'ftruncate',
            });
          }
          if (!(fd.flags & (constants.O_WRONLY | constants.O_RDWR))) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EINVAL,
              syscall: 'ftruncate',
            });
          }
          let data = Buffer.alloc(0);
          for await (const block of this.iNodeMgr.fileGetBlocks(
            tran,
            fd.ino,
            this.blockSize,
          )) {
            data = Buffer.concat([data, block]);
          }
          try {
            if (len > data.length) {
              newData = Buffer.alloc(len);
              data.copy(newData, 0, 0, data.length);
              await this.iNodeMgr.fileSetBlocks(
                tran,
                fd.ino,
                newData,
                this.blockSize,
              );
            } else if (len < data.length) {
              newData = Buffer.allocUnsafe(len);
              data.copy(newData, 0, 0, len);
              await this.iNodeMgr.fileClearData(tran, fd.ino);
              await this.iNodeMgr.fileSetBlocks(
                tran,
                fd.ino,
                newData,
                this.blockSize,
              );
            } else {
              newData = data;
            }
          } catch (e) {
            if (e instanceof RangeError) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EFBIG,
                syscall: 'ftruncate',
              });
            }
            throw e;
          }
          const now = new Date();
          await this.iNodeMgr.statSetProp(tran, fd.ino, 'mtime', now);
          await this.iNodeMgr.statSetProp(tran, fd.ino, 'ctime', now);
          await this.iNodeMgr.statSetProp(tran, fd.ino, 'size', newData.length);
          await fd.setPos(tran, Math.min(newData.length, fd.pos));
        },
        fd ? [fd.ino] : [],
      );
    }, callback);
  }

  public async futimes(
    fdIndex: FdIndex,
    atime: number | string | Date,
    mtime: number | string | Date,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      const fd = this.fdMgr.getFd(fdIndex);
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!fd) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              syscall: 'futimes',
            });
          }
          let newAtime;
          let newMtime;
          if (typeof atime === 'number') {
            newAtime = new Date(atime * 1000);
          } else if (typeof atime === 'string') {
            newAtime = new Date(parseInt(atime) * 1000);
          } else if (atime instanceof Date) {
            newAtime = atime;
          }
          if (typeof mtime === 'number') {
            newMtime = new Date(mtime * 1000);
          } else if (typeof mtime === 'string') {
            newMtime = new Date(parseInt(mtime) * 1000);
          } else if (mtime instanceof Date) {
            newMtime = mtime;
          }
          await this.iNodeMgr.statSetProp(tran, fd.ino, 'atime', newAtime);
          await this.iNodeMgr.statSetProp(tran, fd.ino, 'mtime', newMtime);
          await this.iNodeMgr.statSetProp(tran, fd.ino, 'ctime', new Date());
        },
        fd ? [fd.ino] : [],
      );
    }, callback);
  }

  public async lchmod(
    path: Path,
    mode: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!target) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'lchmod',
            });
          }
          const targetStat = await this.iNodeMgr.statGet(tran, target);
          if (
            this.uid !== permissions.DEFAULT_ROOT_UID &&
            this.uid !== targetStat.uid
          ) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EPERM,
              path: path as string,
              syscall: 'lchmod',
            });
          }
          await this.iNodeMgr.statSetProp(
            tran,
            target,
            'mode',
            (targetStat.mode & constants.S_IFMT) | mode,
          );
        },
        target ? [target] : [],
      );
    }, callback);
  }

  public async lchown(
    path: Path,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!target) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'lchown',
            });
          }
          const targetStat = await this.iNodeMgr.statGet(tran, target);
          if (this.uid !== permissions.DEFAULT_ROOT_UID) {
            // You don't own the file
            if (targetStat.uid !== this.uid) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EPERM,
                path: path as string,
                syscall: 'lchown',
              });
            }
            // You cannot give files to others
            if (this.uid !== uid) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EPERM,
                path: path as string,
                syscall: 'lchown',
              });
            }
            // Because we don't have user group hierarchies, we allow chowning to any group
          }
          await this.iNodeMgr.statSetProp(tran, target, 'uid', uid);
          await this.iNodeMgr.statSetProp(tran, target, 'gid', gid);
        },
        target ? [target] : [],
      );
    }, callback);
  }

  public async link(
    existingPath: Path,
    newPath: Path,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      existingPath = this.getPath(existingPath);
      newPath = this.getPath(newPath);
      const navigatedExisting = await this.navigate(existingPath, false);
      const navigatedNew = await this.navigate(newPath, false);
      const existingTarget = navigatedExisting.target;
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!existingTarget) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: existingPath as string,
              dest: newPath as string,
              syscall: 'link',
            });
          }
          const existingTargetType = (
            await this.iNodeMgr.get(tran, existingTarget)
          )?.type;
          if (existingTargetType === 'Directory') {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EPERM,
              path: existingPath as string,
              dest: newPath as string,
              syscall: 'link',
            });
          }
          if (!navigatedNew.target) {
            const newDirStat = await this.iNodeMgr.statGet(
              tran,
              navigatedNew.dir,
            );
            if (newDirStat.nlink < 2) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.ENOENT,
                path: existingPath as string,
                dest: newPath as string,
                syscall: 'link',
              });
            }
            if (!this.checkPermissions(constants.W_OK, newDirStat)) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EACCES,
                path: existingPath as string,
                dest: newPath as string,
                syscall: 'link',
              });
            }
            const index = await this.iNodeMgr.dirGetEntry(
              tran,
              navigatedExisting.dir,
              navigatedExisting.name,
            );
            await this.iNodeMgr.dirSetEntry(
              tran,
              navigatedNew.dir,
              navigatedNew.name,
              index as INodeIndex,
            );
            await this.iNodeMgr.statSetProp(
              tran,
              existingTarget,
              'ctime',
              new Date(),
            );
          } else {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EEXIST,
              path: existingPath as string,
              dest: newPath as string,
              syscall: 'link',
            });
          }
        },
        existingTarget
          ? [existingTarget, navigatedNew.dir]
          : [navigatedNew.dir],
      );
    }, callback);
  }

  public async lseek(
    fdIndex: FdIndex,
    position: number,
    seekFlags?: number,
  ): Promise<number>;
  public async lseek(
    fdIndex: FdIndex,
    position: number,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async lseek(
    fdIndex: FdIndex,
    position: number,
    seekFlags: number,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async lseek(
    fdIndex: FdIndex,
    position: number,
    seekFlagsOrCallback: number | Callback<[number]> = constants.SEEK_SET,
    callback?: Callback<[number]>,
  ): Promise<number | void> {
    const seekFlags =
      typeof seekFlagsOrCallback !== 'function'
        ? seekFlagsOrCallback
        : constants.SEEK_SET;
    callback =
      typeof seekFlagsOrCallback === 'function'
        ? seekFlagsOrCallback
        : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      const fd = this.fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'lseek',
        });
      }
      await this.iNodeMgr.transact(
        async (tran) => {
          if (
            [
              constants.SEEK_SET,
              constants.SEEK_CUR,
              constants.SEEK_END,
            ].indexOf(seekFlags) === -1
          ) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EINVAL,
              syscall: 'lseek',
            });
          }
          await fd.setPos(tran, position, seekFlags);
        },
        fd ? [fd.ino] : [],
      );
      return fd.pos;
    }, callback);
  }

  public async lstat(path: Path): Promise<Stat>;
  public async lstat(path: Path, callback: Callback<[Stat]>): Promise<void>;
  public async lstat(
    path: Path,
    callback?: Callback<[Stat]>,
  ): Promise<Stat | void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      if (target) {
        let targetStat;
        await this.iNodeMgr.transact(
          async (tran) => {
            targetStat = await this.iNodeMgr.statGet(tran, target);
          },
          [target],
        );
        return new Stat({ ...targetStat });
      } else {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          syscall: 'lstat',
        });
      }
    }, callback);
  }

  public async mkdir(path: Path, mode?: number): Promise<void>;
  public async mkdir(path: Path, callback: Callback): Promise<void>;
  public async mkdir(
    path: Path,
    mode: number,
    callback: Callback,
  ): Promise<void>;
  public async mkdir(
    path: Path,
    modeOrCallback: number | Callback = permissions.DEFAULT_DIRECTORY_PERM,
    callback?: Callback,
  ): Promise<void> {
    const mode =
      typeof modeOrCallback !== 'function'
        ? modeOrCallback
        : permissions.DEFAULT_DIRECTORY_PERM;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      // We expect a non-existent directory
      path = path.replace(/(.+?)\/+$/, '$1');
      const navigated = await this.navigate(path, true);
      if (navigated.target) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EEXIST,
          path: path as string,
          syscall: 'mkdir',
        });
      } else if (!navigated.target && navigated.remaining) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'mkdir',
        });
      } else if (!navigated.target) {
        let navigatedDirStats;
        const dirINode = this.iNodeMgr.inoAllocate();
        await this.iNodeMgr.transact(
          async (tran) => {
            tran.queueFailure(() => {
              this.iNodeMgr.inoDeallocate(dirINode);
            });
            navigatedDirStats = await this.iNodeMgr.statGet(
              tran,
              navigated.dir,
            );
            if (navigatedDirStats['nlink'] < 2) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.ENOENT,
                path: path as string,
                syscall: 'mkdir',
              });
            }
            if (!this.checkPermissions(constants.W_OK, navigatedDirStats)) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EACCES,
                path: path as string,
                syscall: 'mkdir',
              });
            }
            await this.iNodeMgr.dirCreate(
              tran,
              dirINode,
              {
                mode: utils.applyUmask(mode, this.umask),
                uid: this.uid,
                gid: this.gid,
              },
              await this.iNodeMgr.dirGetEntry(tran, navigated.dir, '.'),
            );
            await this.iNodeMgr.dirSetEntry(
              tran,
              navigated.dir,
              navigated.name,
              dirINode,
            );
          },
          [navigated.dir, dirINode],
        );
      }
    }, callback);
  }

  public async mkdirp(path: Path, mode?: number): Promise<void>;
  public async mkdirp(path: Path, callback: Callback): Promise<void>;
  public async mkdirp(
    path: Path,
    mode: number,
    callback: Callback,
  ): Promise<void>;
  public async mkdirp(
    path: Path,
    modeOrCallback: number | Callback = permissions.DEFAULT_DIRECTORY_PERM,
    callback?: Callback,
  ): Promise<void> {
    const mode =
      typeof modeOrCallback !== 'function'
        ? modeOrCallback
        : permissions.DEFAULT_DIRECTORY_PERM;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      // We expect a directory
      path = path.replace(/(.+?)\/+$/, '$1');
      let currentDir, navigatedTargetType;
      let navigated = await this.navigate(path, true);
      while (true) {
        if (!navigated.target) {
          let navigatedDirStat;
          const dirINode = this.iNodeMgr.inoAllocate();
          await this.iNodeMgr.transact(
            async (tran) => {
              tran.queueFailure(() => {
                this.iNodeMgr.inoDeallocate(dirINode);
              });
              navigatedDirStat = await this.iNodeMgr.statGet(
                tran,
                navigated.dir,
              );
              if (navigatedDirStat.nlink < 2) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.ENOENT,
                  path: path as string,
                  syscall: 'mkdirp',
                });
              }
              if (!this.checkPermissions(constants.W_OK, navigatedDirStat)) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.EACCES,
                  path: path as string,
                  syscall: 'mkdirp',
                });
              }
              await this.iNodeMgr.dirCreate(
                tran,
                dirINode,
                {
                  mode: utils.applyUmask(mode, this.umask),
                  uid: this.uid,
                  gid: this.gid,
                },
                await this.iNodeMgr.dirGetEntry(tran, navigated.dir, '.'),
              );
              await this.iNodeMgr.dirSetEntry(
                tran,
                navigated.dir,
                navigated.name,
                dirINode,
              );
            },
            [navigated.dir, dirINode],
          );
          if (navigated.remaining) {
            currentDir = dirINode;
            navigated = await this.navigateFrom(
              currentDir,
              navigated.remaining,
              true,
            );
          } else {
            break;
          }
        } else {
          const navigatedTarget = navigated.target;
          await this.iNodeMgr.transact(
            async (tran) => {
              navigatedTargetType = (
                await this.iNodeMgr.get(tran, navigatedTarget)
              )?.type;
            },
            [navigated.target],
          );
          if (navigatedTargetType !== 'Directory') {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOTDIR,
              path: path as string,
              syscall: 'mkdirp',
            });
          }
          break;
        }
      }
    }, callback);
  }

  public async mkdtemp(
    pathSPrefix: string,
    options?: Options,
  ): Promise<string | Buffer>;
  public async mkdtemp(
    pathSPrefix: string,
    callback: Callback<[string | Buffer]>,
  ): Promise<void>;
  public async mkdtemp(
    pathSPrefix: string,
    options: Options,
    callback: Callback<[string | Buffer]>,
  ): Promise<void>;
  public async mkdtemp(
    pathSPrefix: Path,
    optionsOrCallback: Options | Callback<[string | Buffer]> = {
      encoding: 'utf8',
    },
    callback?: Callback<[string | Buffer]>,
  ): Promise<string | Buffer | void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? this.getOptions({ encoding: 'utf8' }, optionsOrCallback)
        : ({ encoding: 'utf8' } as Options);
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      if (!pathSPrefix || typeof pathSPrefix !== 'string') {
        throw new TypeError('filename prefix is required');
      }
      const getChar = () => {
        const possibleChars =
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return possibleChars[Math.floor(Math.random() * possibleChars.length)];
      };
      let pathS;
      while (true) {
        pathS = pathSPrefix.concat(
          Array.from({ length: 6 }, () => getChar)
            .map((f) => f())
            .join(''),
        );
        try {
          await this.mkdir(pathS);
          if (options.encoding === 'binary') {
            return Buffer.from(pathS);
          } else {
            return Buffer.from(pathS).toString(options.encoding);
          }
        } catch (e) {
          if (e.code !== errno.EEXIST) {
            throw e;
          }
        }
      }
    }, callback);
  }

  public async mknod(
    path: Path,
    type: number,
    major: number,
    minor: number,
    mode?: number,
  ): Promise<void>;
  public async mknod(
    path: Path,
    type: number,
    major: number,
    minor: number,
    callback: Callback,
  ): Promise<void>;
  public async mknod(
    path: Path,
    type: number,
    major: number,
    minor: number,
    mode: number,
    callback: Callback,
  ): Promise<void>;
  public async mknod(
    path: Path,
    type: number,
    major: number,
    minor: number,
    modeOrCallback: number | Callback = permissions.DEFAULT_FILE_PERM,
    callback?: Callback,
  ): Promise<void> {
    const mode =
      typeof modeOrCallback !== 'function'
        ? modeOrCallback
        : permissions.DEFAULT_FILE_PERM;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const navigated = await this.navigate(path, false);
      const iNode = this.iNodeMgr.inoAllocate();
      await this.iNodeMgr.transact(
        async (tran) => {
          tran.queueFailure(() => {
            this.iNodeMgr.inoDeallocate(iNode);
          });
          if (navigated.target) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EEXIST,
              path: path as string,
              syscall: 'mknod',
            });
          }
          const navigatedDirStat = await this.iNodeMgr.statGet(
            tran,
            navigated.dir,
          );
          if (navigatedDirStat.nlink < 2) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'mknod',
            });
          }
          if (!this.checkPermissions(constants.W_OK, navigatedDirStat)) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EACCES,
              path: path as string,
              syscall: 'mknod',
            });
          }
          switch (type) {
            case constants.S_IFREG:
              await this.iNodeMgr.fileCreate(
                tran,
                iNode,
                {
                  mode: utils.applyUmask(mode, this.umask),
                  uid: this.uid,
                  gid: this.gid,
                },
                this.blockSize,
              );
              break;
            default:
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EPERM,
                path: path as string,
                syscall: 'mknod',
              });
          }
          await this.iNodeMgr.dirSetEntry(
            tran,
            navigated.dir,
            navigated.name,
            iNode,
          );
        },
        [navigated.dir, iNode],
      );
    }, callback);
  }

  public async open(
    path: Path,
    flags: string | number,
    mode?: number,
  ): Promise<FdIndex>;
  public async open(
    path: Path,
    flags: string | number,
    callback: Callback<[FdIndex]>,
  ): Promise<void>;
  public async open(
    path: Path,
    flags: string | number,
    mode: number,
    callback: Callback<[FdIndex]>,
  ): Promise<void>;
  public async open(
    path: Path,
    flags: string | number,
    modeOrCallback:
      | number
      | Callback<[FdIndex]> = permissions.DEFAULT_FILE_PERM,
    callback?: Callback<[FdIndex]>,
  ): Promise<FdIndex | void> {
    const mode =
      typeof modeOrCallback !== 'function'
        ? modeOrCallback
        : permissions.DEFAULT_FILE_PERM;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      return (await this._open(path, flags, mode))[1];
    }, callback);
  }

  protected async _open(
    path: Path,
    flags: string | number,
    mode: number = permissions.DEFAULT_FILE_PERM,
  ): Promise<[FileDescriptor, FdIndex]> {
    path = this.getPath(path);
    if (typeof flags === 'string') {
      switch (flags) {
        case 'r':
        case 'rs':
          flags = constants.O_RDONLY;
          break;
        case 'r+':
        case 'rs+':
          flags = constants.O_RDWR;
          break;
        case 'w':
          flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC;
          break;
        case 'wx':
          flags =
            constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_TRUNC |
            constants.O_EXCL;
          break;
        case 'w+':
          flags = constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC;
          break;
        case 'wx+':
          flags =
            constants.O_RDWR |
            constants.O_CREAT |
            constants.O_TRUNC |
            constants.O_EXCL;
          break;
        case 'a':
          flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT;
          break;
        case 'ax':
          flags =
            constants.O_WRONLY |
            constants.O_APPEND |
            constants.O_CREAT |
            constants.O_EXCL;
          break;
        case 'a+':
          flags = constants.O_RDWR | constants.O_APPEND | constants.O_CREAT;
          break;
        case 'ax+':
          flags =
            constants.O_RDWR |
            constants.O_APPEND |
            constants.O_CREAT |
            constants.O_EXCL;
          break;
        default:
          throw new TypeError('Unknown file open flag: ' + flags);
      }
    }
    if (typeof flags !== 'number') {
      throw new TypeError('Unknown file open flag: ' + flags);
    }
    let navigated = await this.navigate(path, false);
    let target = navigated.target;
    const openFlags = flags;
    const openPath = path;
    let openRet;
    // This is needed for the purpose of symlinks, if the navigated target exists
    // and is a symlink we need to go inside and check the target again. So a while
    // loop suits us best. In VFS this was easier as the type checking wasn't as strict
    await this.iNodeMgr.transact(
      async (tran) => {
        while (true) {
          if (!target) {
            // O_CREAT only applies if there's a left over name without any remaining path
            if (!navigated.remaining && openFlags & constants.O_CREAT) {
              let navigatedDirStat;
              const fileINode = this.iNodeMgr.inoAllocate();
              await this.iNodeMgr.transact(
                async (tran) => {
                  tran.queueFailure(() => {
                    this.iNodeMgr.inoDeallocate(fileINode);
                  });
                  navigatedDirStat = await this.iNodeMgr.statGet(
                    tran,
                    navigated.dir,
                  );
                  // Cannot create if the current directory has been unlinked from its parent directory
                  if (navigatedDirStat.nlink < 2) {
                    throw new errors.ErrorEncryptedFSError({
                      errno: errno.ENOENT,
                      path: path as string,
                      syscall: 'open',
                    });
                  }
                  if (
                    !this.checkPermissions(constants.W_OK, navigatedDirStat)
                  ) {
                    throw new errors.ErrorEncryptedFSError({
                      errno: errno.EACCES,
                      path: path as string,
                      syscall: 'open',
                    });
                  }
                  await this.iNodeMgr.fileCreate(
                    tran,
                    fileINode,
                    {
                      mode: utils.applyUmask(mode, this.umask),
                      uid: this.uid,
                      gid: this.gid,
                    },
                    this.blockSize,
                  );
                  await this.iNodeMgr.dirSetEntry(
                    tran,
                    navigated.dir,
                    navigated.name,
                    fileINode,
                  );
                },
                [fileINode, navigated.dir],
              );
              target = fileINode;
              break;
            } else {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.ENOENT,
                path: path as string,
                syscall: 'open',
              });
            }
          } else {
            const targetType = (await this.iNodeMgr.get(tran, target))?.type;
            if (targetType === 'Symlink') {
              // Cannot be symlink if O_NOFOLLOW
              if (openFlags & constants.O_NOFOLLOW) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.ELOOP,
                  path: path as string,
                  syscall: 'open',
                });
              }
              navigated = await this.navigateFrom(
                navigated.dir,
                navigated.name + navigated.remaining,
                true,
                undefined,
                undefined,
                openPath,
              );
              target = navigated.target;
            } else {
              // Target already exists cannot be created exclusively
              if (
                openFlags & constants.O_CREAT &&
                openFlags & constants.O_EXCL
              ) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.EEXIST,
                  path: path as string,
                  syscall: 'open',
                });
              }
              // Cannot be directory if write capabilities are requested
              if (
                targetType === 'Directory' &&
                openFlags &
                  (constants.O_WRONLY |
                    (openFlags &
                      (constants.O_RDWR | (openFlags & constants.O_TRUNC))))
              ) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.EISDIR,
                  path: path as string,
                  syscall: 'open',
                });
              }
              // Must be directory if O_DIRECTORY
              if (
                openFlags & constants.O_DIRECTORY &&
                !(targetType === 'Directory')
              ) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.ENOTDIR,
                  path: path as string,
                  syscall: 'open',
                });
              }
              // Must truncate a file if O_TRUNC
              if (
                openFlags & constants.O_TRUNC &&
                targetType === 'File' &&
                openFlags & (constants.O_WRONLY | constants.O_RDWR)
              ) {
                await this.iNodeMgr.fileClearData(tran, target);
                await this.iNodeMgr.fileSetBlocks(
                  tran,
                  target,
                  Buffer.alloc(0),
                  this.blockSize,
                );
              }
              break;
            }
          }
        }
        // Convert file descriptor access flags into bitwise permission flags
        let access;
        if (openFlags & constants.O_RDWR) {
          access = constants.R_OK | constants.W_OK;
        } else if (
          (openFlags & constants.O_WRONLY) |
          (openFlags & constants.O_TRUNC)
        ) {
          access = constants.W_OK;
        } else {
          access = constants.R_OK;
        }
        const targetStat = await this.iNodeMgr.statGet(tran, target);
        if (!this.checkPermissions(access, targetStat)) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.EACCES,
            path: path as string,
            syscall: 'open',
          });
        }
        try {
          openRet = await this.fdMgr.createFd(target, openFlags);
        } catch (e) {
          if (e instanceof errors.ErrorEncryptedFSError) {
            e.setPaths(path as string);
            e.setSyscall('open');
          }
          throw e;
        }
      },
      navigated.target ? [navigated.target] : [],
    );
    return openRet;
  }

  public async read(
    fdIndex: FdIndex,
    buffer: Data,
    offset?: number,
    length?: number,
    position?: number,
  ): Promise<number>;
  public async read(
    fdIndex: FdIndex,
    buffer: Data,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async read(
    fdIndex: FdIndex,
    buffer: Data,
    offset: number,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async read(
    fdIndex: FdIndex,
    buffer: Data,
    offset: number,
    length: number,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async read(
    fdIndex: FdIndex,
    buffer: Data,
    offset: number,
    length: number,
    position: number,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async read(
    fdIndex: FdIndex,
    buffer: Data,
    offsetOrCallback: number | Callback<[number]> = 0,
    lengthOrCallback: number | Callback<[number]> = 0,
    positionOrCallback: number | undefined | Callback<[number]> = undefined,
    callback?: Callback<[number]>,
  ): Promise<number | void> {
    const offset =
      typeof offsetOrCallback !== 'function' ? offsetOrCallback : 0;
    const length =
      typeof lengthOrCallback !== 'function' ? lengthOrCallback : 0;
    const position =
      typeof positionOrCallback !== 'function' ? positionOrCallback : undefined;
    callback =
      typeof offsetOrCallback === 'function'
        ? offsetOrCallback
        : typeof lengthOrCallback === 'function'
        ? lengthOrCallback
        : typeof positionOrCallback === 'function'
        ? positionOrCallback
        : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      const fd = this.fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'read',
        });
      }
      if (typeof position === 'number' && position < 0) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EINVAL,
          syscall: 'read',
        });
      }
      let fdStat;
      await this.iNodeMgr.transact(
        async (tran) => {
          fdStat = await this.iNodeMgr.statGet(tran, fd.ino);
        },
        [fd.ino],
      );
      if (fdStat.isDirectory()) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EISDIR,
          syscall: 'read',
        });
      }
      const flags = fd.flags;
      if (flags & constants.O_WRONLY) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'read',
        });
      }
      if (offset < 0 || offset > buffer.length) {
        throw new RangeError('Offset is out of bounds');
      }
      if (length < 0 || length > buffer.length) {
        throw new RangeError('Length extends beyond buffer');
      }
      buffer = this.getBuffer(buffer).slice(offset, offset + length);
      let bytesRead;
      try {
        bytesRead = await fd.read(buffer as Buffer, position);
      } catch (e) {
        if (e instanceof errors.ErrorEncryptedFSError) {
          e.setSyscall('read');
        }
        throw e;
      }
      return bytesRead;
    }, callback);
  }

  public async readdir(
    path: Path,
    options?: Options,
  ): Promise<Array<string | Buffer>>;
  public async readdir(
    path: Path,
    callback: Callback<[Array<string | Buffer>]>,
  ): Promise<void>;
  public async readdir(
    path: Path,
    options: Options,
    callback: Callback<[Array<string | Buffer>]>,
  ): Promise<void>;
  public async readdir(
    path: Path,
    optionsOrCallback?: Options | Callback<[Array<string | Buffer>]>,
    callback?: Callback<[Array<string | Buffer>]>,
  ): Promise<Array<string | Buffer> | void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? this.getOptions({ encoding: 'utf8' }, optionsOrCallback)
        : { encoding: 'utf8' as BufferEncoding };
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const navigated = await this.navigate(path, true);
      let navigatedTargetType, navigatedTargetStat;
      const target = navigated.target;
      const navigatedTargetEntries: Array<[string | Buffer, INodeIndex]> = [];
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!target) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'readdir',
            });
          }
          navigatedTargetType = (await this.iNodeMgr.get(tran, target))?.type;
          navigatedTargetStat = await this.iNodeMgr.statGet(tran, target);
          if (navigatedTargetType !== 'Directory') {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOTDIR,
              path: path as string,
              syscall: 'readdir',
            });
          }
          if (!this.checkPermissions(constants.R_OK, navigatedTargetStat)) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EACCES,
              path: path as string,
              syscall: 'readdir',
            });
          }
          for await (const dirEntry of this.iNodeMgr.dirGet(tran, target)) {
            navigatedTargetEntries.push(dirEntry);
          }
        },
        target ? [target] : [],
      );
      return navigatedTargetEntries
        .filter(([name]) => name !== '.' && name !== '..')
        .map(([name]) => {
          if (options.encoding === 'binary') {
            return Buffer.from(name);
          } else {
            return Buffer.from(name).toString(options.encoding);
          }
        });
    }, callback);
  }

  public async readFile(
    file: File,
    options?: Options,
  ): Promise<string | Buffer>;
  public async readFile(
    file: File,
    callback: Callback<[string | Buffer]>,
  ): Promise<void>;
  public async readFile(
    file: File,
    options: Options,
    callback: Callback<[string | Buffer]>,
  ): Promise<void>;
  public async readFile(
    file: File,
    optionsOrCallback?: Options | Callback<[string | Buffer]>,
    callback?: Callback<[string | Buffer]>,
  ): Promise<string | Buffer | void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? this.getOptions({}, optionsOrCallback)
        : ({} as Options);
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      options.flag = 'r';
      let fdIndex;
      try {
        const buffer = Buffer.allocUnsafe(this.blockSize);
        let totalBuffer = Buffer.alloc(0);
        let bytesRead;
        if (typeof file === 'number') {
          while (bytesRead !== 0) {
            bytesRead = await this.read(file, buffer, 0, buffer.length);
            totalBuffer = Buffer.concat([
              totalBuffer,
              buffer.slice(0, bytesRead),
            ]);
          }
        } else {
          fdIndex = await this.open(file as Path, options.flag);
          while (bytesRead !== 0) {
            bytesRead = await this.read(fdIndex, buffer, 0, buffer.length);
            totalBuffer = Buffer.concat([
              totalBuffer,
              buffer.slice(0, bytesRead),
            ]);
          }
        }
        return options.encoding
          ? totalBuffer.toString(options.encoding)
          : totalBuffer;
      } finally {
        if (fdIndex !== undefined) await this.close(fdIndex);
      }
    }, callback);
  }

  public async readlink(
    path: Path,
    options?: Options,
  ): Promise<string | Buffer>;
  public async readlink(
    path: Path,
    callback: Callback<[string | Buffer]>,
  ): Promise<void>;
  public async readlink(
    path: Path,
    options: Options,
    callback: Callback<[string | Buffer]>,
  ): Promise<void>;
  public async readlink(
    path: Path,
    optionsOrCallback: Options | Callback<[string | Buffer]> = {
      encoding: 'utf8',
    },
    callback?: Callback<[string | Buffer]>,
  ): Promise<string | Buffer | void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? this.getOptions({ encoding: 'utf8' }, optionsOrCallback)
        : ({ encoding: 'utf8' } as Options);
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      let link;
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!target) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'readlink',
            });
          }
          const targetType = (await this.iNodeMgr.get(tran, target))?.type;
          if (!(targetType === 'Symlink')) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EINVAL,
              path: path as string,
              syscall: 'readlink',
            });
          }
          link = await this.iNodeMgr.symlinkGetLink(tran, target);
        },
        target ? [target] : [],
      );
      if (options.encoding === 'binary') {
        return Buffer.from(link);
      } else {
        return Buffer.from(link).toString(options.encoding);
      }
    }, callback);
  }

  public async realpath(
    path: Path,
    options?: Options,
  ): Promise<string | Buffer>;
  public async realpath(
    path: Path,
    callback: Callback<[string | Buffer]>,
  ): Promise<void>;
  public async realpath(
    path: Path,
    options: Options,
    callback: Callback<[string | Buffer]>,
  ): Promise<void>;
  public async realpath(
    path: Path,
    optionsOrCallback: Options | Callback<[string | Buffer]> = {
      encoding: 'utf8',
    },
    callback?: Callback<[string | Buffer]>,
  ): Promise<string | Buffer | void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? this.getOptions({ encoding: 'utf8' }, optionsOrCallback)
        : ({ encoding: 'utf8' } as Options);
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const navigated = await this.navigate(path, true);
      if (!navigated.target) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'realpath',
        });
      }
      if (options.encoding === 'binary') {
        return Buffer.from('/' + navigated.pathStack.join('/'));
      } else {
        return Buffer.from('/' + navigated.pathStack.join('/')).toString(
          options.encoding,
        );
      }
    }, callback);
  }

  public async rename(
    oldPath: Path,
    newPath: Path,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      oldPath = this.getPath(oldPath);
      newPath = this.getPath(newPath);
      const navigatedSource = await this.navigate(oldPath, false);
      const navigatedTarget = await this.navigate(newPath, false);
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!navigatedSource.target || navigatedTarget.remaining) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: oldPath as string,
              dest: newPath as string,
              syscall: 'rename',
            });
          }
          const sourceTarget = navigatedSource.target;
          const sourceTargetType = (await this.iNodeMgr.get(tran, sourceTarget))
            ?.type;
          if (sourceTargetType === 'Directory') {
            // If oldPath is a directory, target must be a directory (if it exists)
            if (navigatedTarget.target) {
              const targetTargetType = (
                await this.iNodeMgr.get(tran, navigatedTarget.target)
              )?.type;
              if (!(targetTargetType === 'Directory')) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.ENOTDIR,
                  path: oldPath as string,
                  dest: newPath as string,
                  syscall: 'rename',
                });
              }
            }
            // Neither oldPath nor newPath can point to root
            if (
              navigatedSource.target === this.rootIno ||
              navigatedTarget.target === this.rootIno
            ) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EBUSY,
                path: oldPath as string,
                dest: newPath as string,
                syscall: 'rename',
              });
            }
            // If the target directory contains elements this cannot be done
            // this can be done without read permissions
            if (navigatedTarget.target) {
              const targetEntries: Array<[string, INodeIndex]> = [];
              for await (const entry of this.iNodeMgr.dirGet(
                tran,
                navigatedTarget.target,
              )) {
                targetEntries.push(entry);
              }
              if (targetEntries.length - 2) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.ENOTEMPTY,
                  path: oldPath as string,
                  dest: newPath as string,
                  syscall: 'rename',
                });
              }
            }
            // If any of the paths used .. or ., then `dir` is not the parent directory
            if (
              navigatedSource.name === '.' ||
              navigatedSource.name === '..' ||
              navigatedTarget.name === '.' ||
              navigatedTarget.name === '..'
            ) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EBUSY,
                path: oldPath as string,
                dest: newPath as string,
                syscall: 'rename',
              });
            }
            // Cannot rename a source prefix of target
            if (
              navigatedSource.pathStack.length <
              navigatedTarget.pathStack.length
            ) {
              let prefixOf = true;
              for (let i = 0; i < navigatedSource.pathStack.length; ++i) {
                if (
                  navigatedSource.pathStack[i] !== navigatedTarget.pathStack[i]
                ) {
                  prefixOf = false;
                  break;
                }
              }
              if (prefixOf) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.EINVAL,
                  path: oldPath as string,
                  dest: newPath as string,
                  syscall: 'rename',
                });
              }
            }
          } else {
            // If oldPath is not a directory, then newPath cannot be an existing directory
            if (navigatedTarget.target) {
              const targetTargetType = (
                await this.iNodeMgr.get(tran, navigatedTarget.target)
              )?.type;
              if (targetTargetType === 'Directory') {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.EISDIR,
                  path: oldPath as string,
                  dest: newPath as string,
                  syscall: 'rename',
                });
              }
            }
          }
          const sourceDirStat = await this.iNodeMgr.statGet(
            tran,
            navigatedSource.dir,
          );
          const targetDirStat = await this.iNodeMgr.statGet(
            tran,
            navigatedTarget.dir,
          );
          // Both the navigatedSource.dir and navigatedTarget.dir must support write permissions
          if (
            !this.checkPermissions(constants.W_OK, sourceDirStat) ||
            !this.checkPermissions(constants.W_OK, targetDirStat)
          ) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EACCES,
              path: oldPath as string,
              dest: newPath as string,
              syscall: 'rename',
            });
          }
          // If they are in the same directory, it is simple rename
          if (navigatedSource.dir === navigatedTarget.dir) {
            try {
              await this.iNodeMgr.dirResetEntry(
                tran,
                navigatedSource.dir,
                navigatedSource.name,
                navigatedTarget.name,
              );
            } catch (e) {
              if (e instanceof inodesErrors.ErrorINodesInvalidName) {
                throw new errors.ErrorEncryptedFSError({
                  errno: errno.ENOENT,
                  path: oldPath as string,
                  dest: newPath as string,
                  syscall: 'rename',
                });
              }
              throw e;
            }
            return;
          }
          const index = (await this.iNodeMgr.dirGetEntry(
            tran,
            navigatedSource.dir,
            navigatedSource.name,
          )) as INodeIndex;
          const now = new Date();
          if (navigatedTarget.target) {
            await this.iNodeMgr.statSetProp(
              tran,
              navigatedTarget.target,
              'ctime',
              now,
            );
            await this.iNodeMgr.dirUnsetEntry(
              tran,
              navigatedTarget.dir,
              navigatedTarget.name,
            );
            await this.iNodeMgr.dirSetEntry(
              tran,
              navigatedTarget.dir,
              navigatedTarget.name,
              index,
            );
            await this.iNodeMgr.statSetProp(
              tran,
              navigatedTarget.target,
              'ctime',
              now,
            );
          } else {
            if (targetDirStat.nlink < 2) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.ENOENT,
                path: oldPath as string,
                dest: newPath as string,
                syscall: 'rename',
              });
            }
            await this.iNodeMgr.dirSetEntry(
              tran,
              navigatedTarget.dir,
              navigatedTarget.name,
              index,
            );
          }
          await this.iNodeMgr.statSetProp(tran, sourceTarget, 'ctime', now);
          await this.iNodeMgr.dirUnsetEntry(
            tran,
            navigatedSource.dir,
            navigatedSource.name,
          );
        },
        navigatedTarget.target
          ? navigatedSource.target
            ? [navigatedTarget.target, navigatedSource.target]
            : [navigatedTarget.target]
          : navigatedSource.target
          ? [navigatedSource.target]
          : [],
      );
    }, callback);
  }

  public async rmdir(path: Path, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      // If the path has trailing slashes, navigation would traverse into it
      // we must trim off these trailing slashes to allow these directories to be removed
      path = path.replace(/(.+?)\/+$/, '$1');
      const navigated = await this.navigate(path, false);
      // On linux, when .. is used, the parent directory becomes unknown
      // in that case, they return with ENOTEMPTY
      // but the directory may in fact be empty
      // for this edge case, we instead use EINVAL
      if (navigated.name === '.' || navigated.name === '..') {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EINVAL,
          path: path as string,
          syscall: 'rmdir',
        });
      }
      await this.iNodeMgr.transact(
        async (tran) => {
          // This is for if the path resolved to root
          if (!navigated.name) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBUSY,
              path: path as string,
              syscall: 'rmdir',
            });
          }
          if (!navigated.target) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'rmdir',
            });
          }
          const target = navigated.target;
          const dir = navigated.dir;
          const targetEntries: Array<[string | Buffer, INodeIndex]> = [];
          const targetType = (await this.iNodeMgr.get(tran, target))?.type;
          const dirStat = await this.iNodeMgr.statGet(tran, dir);
          for await (const entry of this.iNodeMgr.dirGet(tran, target)) {
            targetEntries.push(entry);
          }
          if (!(targetType === 'Directory')) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOTDIR,
              path: path as string,
              syscall: 'rmdir',
            });
          }
          if (targetEntries.length - 2) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOTEMPTY,
              path: path as string,
              syscall: 'rmdir',
            });
          }
          if (!this.checkPermissions(constants.W_OK, dirStat)) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EACCES,
              path: path as string,
              syscall: 'rmdir',
            });
          }
          await this.iNodeMgr.dirUnsetEntry(tran, dir, navigated.name);
        },
        navigated.target ? [navigated.target, navigated.dir] : [navigated.dir],
      );
    }, callback);
  }

  public async stat(path: Path): Promise<Stat>;
  public async stat(path: Path, callback: Callback<[Stat]>): Promise<void>;
  public async stat(
    path: Path,
    callback?: Callback<[Stat]>,
  ): Promise<Stat | void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (target) {
        let targetStat;
        await this.iNodeMgr.transact(
          async (tran) => {
            targetStat = await this.iNodeMgr.statGet(tran, target);
          },
          [target],
        );
        return new Stat({ ...targetStat });
      } else {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'stat',
        });
      }
    }, callback);
  }

  public async symlink(
    dstPath: Path,
    srcPath: Path,
    type?: string,
  ): Promise<void>;
  public async symlink(
    dstPath: Path,
    srcPath: Path,
    callback: Callback,
  ): Promise<void>;
  public async symlink(
    dstPath: Path,
    srcPath: Path,
    type: string,
    callback: Callback,
  ): Promise<void>;
  public async symlink(
    dstPath: Path,
    srcPath: Path,
    typeOrCallback: string | Callback = 'file',
    callback?: Callback,
  ): Promise<void> {
    callback = typeof typeOrCallback === 'function' ? typeOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      dstPath = this.getPath(dstPath);
      srcPath = this.getPath(srcPath);
      if (!dstPath) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: srcPath as string,
          dest: dstPath as string,
          syscall: 'symlink',
        });
      }
      const navigated = await this.navigate(srcPath, false);
      if (!navigated.target) {
        const symlinkINode = this.iNodeMgr.inoAllocate();
        await this.iNodeMgr.transact(
          async (tran) => {
            const dirStat = await this.iNodeMgr.statGet(tran, navigated.dir);
            if (dirStat.nlink < 2) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.ENOENT,
                path: srcPath as string,
                dest: dstPath as string,
                syscall: 'symlink',
              });
            }
            if (!this.checkPermissions(constants.W_OK, dirStat)) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EACCES,
                path: srcPath as string,
                dest: dstPath as string,
                syscall: 'symlink',
              });
            }
            await this.iNodeMgr.symlinkCreate(
              tran,
              symlinkINode,
              {
                mode: permissions.DEFAULT_SYMLINK_PERM,
                uid: this.uid,
                gid: this.gid,
              },
              dstPath as string,
            );
            await this.iNodeMgr.dirSetEntry(
              tran,
              navigated.dir,
              navigated.name,
              symlinkINode,
            );
          },
          [navigated.dir, symlinkINode],
        );
      } else {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EEXIST,
          path: srcPath as string,
          dest: dstPath as string,
          syscall: 'symlink',
        });
      }
    }, callback);
  }

  public async truncate(file: File, len?: number): Promise<void>;
  public async truncate(file: File, callback: Callback): Promise<void>;
  public async truncate(
    file: File,
    len: number,
    callback: Callback,
  ): Promise<void>;
  public async truncate(
    file: File,
    lenOrCallback: number | Callback = 0,
    callback?: Callback,
  ): Promise<void> {
    const len = typeof lenOrCallback !== 'function' ? lenOrCallback : 0;
    callback = typeof lenOrCallback === 'function' ? lenOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      if (len < 0) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EINVAL,
          syscall: 'ftruncate',
        });
      }
      if (typeof file === 'number') {
        await this.ftruncate(file, len);
      } else {
        file = this.getPath(file as Path);
        let fdIndex;
        try {
          fdIndex = await this.open(file, constants.O_WRONLY);
          await this.ftruncate(fdIndex, len);
        } finally {
          if (fdIndex !== undefined) await this.close(fdIndex);
        }
      }
    }, callback);
  }

  public async unlink(path: Path, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const navigated = await this.navigate(path, false);
      if (!navigated.target) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'unlink',
        });
      }
      const target = navigated.target;
      await this.iNodeMgr.transact(
        async (tran) => {
          const dirStat = await this.iNodeMgr.statGet(tran, navigated.dir);
          const targetType = (await this.iNodeMgr.get(tran, target))?.type;
          if (!this.checkPermissions(constants.W_OK, dirStat)) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EACCES,
              path: path as string,
              syscall: 'unlink',
            });
          }
          if (targetType === 'Directory') {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EISDIR,
              path: path as string,
              syscall: 'unlink',
            });
          }
          const now = new Date();
          await this.iNodeMgr.statSetProp(tran, target, 'ctime', now);
          await this.iNodeMgr.dirUnsetEntry(
            tran,
            navigated.dir,
            navigated.name,
          );
        },
        navigated.dir === navigated.target
          ? [navigated.dir]
          : [navigated.dir, navigated.target],
      );
    }, callback);
  }

  public async utimes(
    path: Path,
    atime: number | string | Date,
    mtime: number | string | Date,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      await this.iNodeMgr.transact(
        async (tran) => {
          if (!target) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'utimes',
            });
          }
          let newAtime;
          let newMtime;
          if (typeof atime === 'number') {
            newAtime = new Date(atime * 1000);
          } else if (typeof atime === 'string') {
            newAtime = new Date(parseInt(atime) * 1000);
          } else if (atime instanceof Date) {
            newAtime = atime;
          }
          if (typeof mtime === 'number') {
            newMtime = new Date(mtime * 1000);
          } else if (typeof mtime === 'string') {
            newMtime = new Date(parseInt(mtime) * 1000);
          } else if (mtime instanceof Date) {
            newMtime = mtime;
          }
          await this.iNodeMgr.statSetProp(tran, target, 'atime', newAtime);
          await this.iNodeMgr.statSetProp(tran, target, 'mtime', newMtime);
          await this.iNodeMgr.statSetProp(tran, target, 'ctime', new Date());
        },
        target ? [target] : [],
      );
    }, callback);
  }

  public async write(
    fdIndex: FdIndex,
    data: Data,
    offsetOrPos?: number,
    lengthOrEncoding?: number | string,
    position?: number,
  ): Promise<number>;
  public async write(
    fdIndex: FdIndex,
    data: Data,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async write(
    fdIndex: FdIndex,
    data: Data,
    offsetOrPos: number,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async write(
    fdIndex: FdIndex,
    data: Data,
    offsetOrPos: number,
    lengthOrEncoding: number | string,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async write(
    fdIndex: FdIndex,
    data: Data,
    offsetOrPos: number,
    lengthOrEncoding: number | string,
    position: number,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async write(
    fdIndex: FdIndex,
    data: Data,
    offsetOrPosOrCallback?: number | Callback<[number]>,
    lengthOrEncodingOrCallback?: number | string | Callback<[number]>,
    positionOrCallback: number | undefined | Callback<[number]> = undefined,
    callback?: Callback<[number]>,
  ): Promise<number | void> {
    let offsetOrPos =
      typeof offsetOrPosOrCallback !== 'function'
        ? offsetOrPosOrCallback
        : undefined;
    let lengthOrEncoding =
      typeof lengthOrEncodingOrCallback !== 'function'
        ? lengthOrEncodingOrCallback
        : undefined;
    let position =
      typeof positionOrCallback !== 'function' ? positionOrCallback : undefined;
    callback =
      typeof offsetOrPosOrCallback === 'function'
        ? offsetOrPosOrCallback
        : typeof lengthOrEncodingOrCallback === 'function'
        ? lengthOrEncodingOrCallback
        : typeof positionOrCallback === 'function'
        ? positionOrCallback
        : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      const fd = this.fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'write',
        });
      }
      if (typeof position === 'number' && position < 0) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EINVAL,
          syscall: 'write',
        });
      }
      const flags = fd.flags;
      if (!(flags & (constants.O_WRONLY | constants.O_RDWR))) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'write',
        });
      }
      let buffer;
      if (typeof data === 'string') {
        position = typeof offsetOrPos === 'number' ? offsetOrPos : undefined;
        lengthOrEncoding =
          typeof lengthOrEncoding === 'string' ? lengthOrEncoding : 'utf8';
        buffer = this.getBuffer(data, lengthOrEncoding as BufferEncoding);
      } else {
        offsetOrPos = typeof offsetOrPos === 'number' ? offsetOrPos : 0;
        if (offsetOrPos < 0 || offsetOrPos > data.length) {
          throw new RangeError('Offset is out of bounds');
        }
        lengthOrEncoding =
          typeof lengthOrEncoding === 'number' ? lengthOrEncoding : data.length;
        if (lengthOrEncoding < 0 || lengthOrEncoding > data.length) {
          throw new RangeError('Length is out of bounds');
        }
        buffer = this.getBuffer(data).slice(
          offsetOrPos,
          offsetOrPos + lengthOrEncoding,
        );
      }
      try {
        return await fd.write(buffer, position);
      } catch (e) {
        if (e instanceof RangeError) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.EFBIG,
            syscall: 'write',
          });
        }
        if (e instanceof errors.ErrorEncryptedFSError) {
          e.setSyscall('write');
        }
        throw e;
      }
    }, callback);
  }

  public async writeFile(
    file: File,
    data?: Data,
    options?: Options,
  ): Promise<void>;
  public async writeFile(
    file: File,
    data: Data,
    callback: Callback,
  ): Promise<void>;
  public async writeFile(
    file: File,
    data: Data,
    options: Options,
    callback: Callback,
  ): Promise<void>;
  public async writeFile(
    file: File,
    data: Data = 'undefined',
    optionsOrCallback: Options | Callback = {
      encoding: 'utf8',
      mode: permissions.DEFAULT_FILE_PERM,
      flag: 'w',
    },
    callback?: Callback,
  ): Promise<void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? this.getOptions(
            { encoding: 'utf8', mode: permissions.DEFAULT_FILE_PERM },
            optionsOrCallback,
          )
        : ({
            encoding: 'utf8',
            mode: permissions.DEFAULT_FILE_PERM,
          } as Options);
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (!this._running) {
        throw new errors.ErrorEncryptedFSNotRunning();
      }
      let fdIndex;
      options.flag = 'w';
      const buffer = this.getBuffer(data, options.encoding);
      let fdCheck = false;
      if (typeof file !== 'number') {
        fdIndex = await this.open(file as Path, options.flag, options.mode);
        fdCheck = true;
      } else {
        fdIndex = file;
      }
      try {
        await this.write(fdIndex, buffer, 0, buffer.length, 0);
      } finally {
        if (fdIndex !== undefined && fdCheck) await this.close(fdIndex);
      }
    }, callback);
  }

  /**
   * Navigates the filesystem tree from root.
   * You can interpret the results like:
   *   !target       => Non-existent segment
   *   name === ''   => Target is at root
   *   name === '.'  => dir is the same as target
   *   name === '..' => dir is a child directory
   */
  protected async navigate(
    pathS: string,
    resolveLastLink: boolean = true,
    activeSymlinks: Set<INodeIndex> = new Set(),
    origPathS: string = pathS,
  ): Promise<Navigated> {
    if (!pathS) {
      throw new errors.ErrorEncryptedFSError({
        errno: errno.ENOENT,
        path: origPathS,
      });
    }
    // Multiple consecutive slashes are considered to be 1 slash
    pathS = pathS.replace(/\/+/, '/');
    // A trailing slash is considered to refer to a directory, thus it is converted to /.
    // functions that expect and specially handle missing directories should trim it away
    pathS = pathS.replace(/\/$/, '/.');
    if (pathS[0] === '/') {
      pathS = pathS.substring(1);
      if (!pathS) {
        return {
          dir: this.rootIno,
          target: this.rootIno,
          // Root is the only situation where the name is empty
          name: '',
          remaining: '',
          pathStack: [],
        };
      } else {
        return await this.navigateFrom(
          this.rootIno,
          pathS,
          resolveLastLink,
          activeSymlinks,
          [],
          origPathS,
        );
      }
    } else {
      return await this.navigateFrom(
        this._cwd.ino,
        pathS,
        resolveLastLink,
        activeSymlinks,
        this._cwd.pathStack,
        origPathS,
      );
    }
  }

  /**
   * Navigates the filesystem tree from a given directory.
   * You should not use this directly unless you first call _navigate and pass the remaining path to _navigateFrom.
   * Note that the pathStack is always the full path to the target.
   */
  protected async navigateFrom(
    curdir: INodeIndex,
    pathS: string,
    resolveLastLink: boolean = true,
    activeSymlinks: Set<INodeIndex> = new Set(),
    pathStack: Array<string> = [],
    origPathS: string = pathS,
  ): Promise<Navigated> {
    if (!pathS) {
      throw new errors.ErrorEncryptedFSError({
        errno: errno.ENOENT,
        path: origPathS,
      });
    }
    let curdirStat;
    await this.iNodeMgr.transact(
      async (tran) => {
        curdirStat = await this.iNodeMgr.statGet(tran, curdir);
      },
      [curdir],
    );
    if (!this.checkPermissions(constants.X_OK, curdirStat)) {
      throw new errors.ErrorEncryptedFSError({
        errno: errno.EACCES,
        path: origPathS,
      });
    }
    const parse = this.parsePath(pathS);
    if (parse.segment !== '.') {
      if (parse.segment === '..') {
        // This is a noop if the pathStack is empty
        pathStack.pop();
      } else {
        pathStack.push(parse.segment);
      }
    }
    let nextDir, nextPath, target, targetType;
    await this.iNodeMgr.transact(
      async (tran) => {
        if (parse.segment === '..' && curdir === this.rootIno) {
          target = curdir;
        } else {
          target = await this.iNodeMgr.dirGetEntry(tran, curdir, parse.segment);
        }
      },
      [curdir],
    );
    if (target) {
      await this.iNodeMgr.transact(async (tran) => {
        const targetData = await this.iNodeMgr.get(tran, target);
        targetType = targetData?.type;
      });
      switch (targetType) {
        case 'File': {
          if (!parse.rest) {
            return {
              dir: curdir,
              target: target,
              name: parse.segment,
              remaining: '',
              pathStack: pathStack,
            };
          }
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOTDIR,
            path: origPathS,
          });
        }
        case 'Directory':
          {
            if (!parse.rest) {
              // If parse.segment is ., dir is not the same directory as target
              // if parse.segment is .., dir is the child directory
              return {
                dir: curdir,
                target: target,
                name: parse.segment,
                remaining: '',
                pathStack: pathStack,
              };
            }
            nextDir = target;
            nextPath = parse.rest;
          }
          break;
        case 'Symlink':
          {
            if (!resolveLastLink && !parse.rest) {
              return {
                dir: curdir,
                target: target,
                name: parse.segment,
                remaining: '',
                pathStack: pathStack,
              };
            }
            if (activeSymlinks.has(target)) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.ELOOP,
                path: origPathS,
              });
            } else {
              activeSymlinks.add(target);
            }
            // Although symlinks should not have an empty links, it's still handled correctly here
            let targetLinks;
            await this.iNodeMgr.transact(async (tran) => {
              targetLinks = await this.iNodeMgr.symlinkGetLink(tran, target);
            });
            nextPath = utils.pathJoin(targetLinks, parse.rest);
            if (nextPath[0] === '/') {
              return this.navigate(
                nextPath,
                resolveLastLink,
                activeSymlinks,
                origPathS,
              );
            } else {
              pathStack.pop();
              nextDir = curdir;
            }
          }
          break;
        default:
          return {
            dir: curdir,
            target: undefined,
            name: parse.segment,
            remaining: parse.rest,
            pathStack: pathStack,
          };
      }
    } else {
      return {
        dir: curdir,
        target: undefined,
        name: parse.segment,
        remaining: parse.rest,
        pathStack: pathStack,
      };
    }
    return this.navigateFrom(
      nextDir,
      nextPath,
      resolveLastLink,
      activeSymlinks,
      pathStack,
      origPathS,
    );
  }

  /**
   * Parses and extracts the first path segment.
   */
  protected parsePath(pathS: string): ParsedPath {
    const matches = pathS.match(/^([\s\S]*?)(?:\/+|$)([\s\S]*)/);
    if (matches) {
      const segment = matches[1] || '';
      const rest = matches[2] || '';
      return {
        segment: segment,
        rest: rest,
      };
    } else {
      // This should not happen
      throw new Error(`Could not parse pathS: ${pathS}`);
    }
  }

  /**
   * Checks the permissions fixng the current uid and gid.
   * If the user is root, they can access anything.
   */
  protected checkPermissions(access: number, stat: Stat): boolean {
    if (this.uid !== permissions.DEFAULT_ROOT_UID) {
      return utils.checkPermissions(access, this.uid, this.gid, stat);
    } else {
      return true;
    }
  }

  /**
   * Processes path types and collapses it to a string.
   * The path types can be string or Buffer or URL.
   */
  protected getPath(path: Path): string {
    if (typeof path === 'string') {
      return path;
    }
    if (path instanceof Buffer) {
      return path.toString();
    }
    if (typeof path === 'object' && typeof path.pathname === 'string') {
      return this.getPathFromURL(path);
    }
    throw new TypeError('path must be a string or Buffer or URL');
  }

  /**
   * Acquires the file path from an URL object.
   */
  protected getPathFromURL(url: URL): string {
    if (url.hostname) {
      throw new TypeError('ERR_INVALID_FILE_URL_HOST');
    }
    const pathname = url.pathname;
    if (pathname.match(/%2[fF]/)) {
      // Must not allow encoded slashes
      throw new TypeError('ERR_INVALID_FILE_URL_PATH');
    }
    return decodeURIComponent(pathname);
  }

  /**
   * Takes a default set of options, and merges them shallowly into the user provided options.
   * Object spread syntax will ignore an undefined or null options object.
   */
  protected getOptions(
    defaultOptions: {
      encoding?: BufferEncoding | undefined;
      mode?: number;
      flag?: string;
    },
    options?: Options | BufferEncoding,
  ): Options {
    if (typeof options === 'string') {
      return { ...defaultOptions, encoding: options };
    } else {
      return { ...defaultOptions, ...options };
    }
  }

  /**
   * Processes data types and collapses it to a Buffer.
   * The data types can be Buffer or Uint8Array or string.
   */
  protected getBuffer(
    data: Data,
    encoding: BufferEncoding | undefined = undefined,
  ): Buffer {
    if (data instanceof Buffer) {
      return data;
    }
    if (data instanceof Uint8Array) {
      // Zero copy implementation
      // also sliced to the view's constraint
      return Buffer.from(data.buffer).slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      );
    }
    if (typeof data === 'string') {
      return Buffer.from(data, encoding);
    }
    throw new TypeError('data must be Buffer or Uint8Array or string');
  }
}

export default EncryptedFS;
