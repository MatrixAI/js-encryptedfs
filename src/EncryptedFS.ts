import type { DBTransaction } from '@matrixai/db';
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
import type { INodeIndex, INodeType } from './inodes';
import type { FdIndex, FileDescriptor } from './fd';
import type { OptionsStream } from './streams';
import type { ResourceRelease } from '@matrixai/resources';
import { code as errno } from 'errno';
import Logger from '@matrixai/logger';
import { DB, errors as dbErrors } from '@matrixai/db';
import {
  CreateDestroyStartStop,
  ready,
} from '@matrixai/async-init/dist/CreateDestroyStartStop';
import CurrentDirectory from './CurrentDirectory';
import Stat from './Stat';
import { INodeManager, errors as inodesErrors } from './inodes';
import { FileDescriptorManager } from './fd';
import { ReadStream, WriteStream } from './streams';
import * as constants from './constants';
import * as permissions from './permissions';
import * as utils from './utils';
import * as errors from './errors';

interface EncryptedFS extends CreateDestroyStartStop {}
@CreateDestroyStartStop(
  new errors.ErrorEncryptedFSRunning(),
  new errors.ErrorEncryptedFSDestroyed(),
)
class EncryptedFS {
  public static async createEncryptedFS({
    dbPath,
    dbKey,
    iNodeMgr,
    fdMgr,
    blockSize,
    umask,
    logger,
    fresh,
  }: {
    dbPath: string;
    dbKey: Buffer;
    iNodeMgr?: INodeManager;
    fdMgr?: FileDescriptorManager;
    blockSize?: number;
    umask?: number;
    logger?: Logger;
    fresh?: boolean;
  }): Promise<EncryptedFS>;
  public static async createEncryptedFS({
    db,
    iNodeMgr,
    fdMgr,
    blockSize,
    umask,
    logger,
    fresh,
  }: {
    db: DB;
    iNodeMgr?: INodeManager;
    fdMgr?: FileDescriptorManager;
    blockSize?: number;
    umask?: number;
    logger?: Logger;
    fresh?: boolean;
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
    fresh = false,
  }: {
    dbPath?: string;
    dbKey?: Buffer;
    db?: DB;
    iNodeMgr?: INodeManager;
    fdMgr?: FileDescriptorManager;
    blockSize?: number;
    umask?: number;
    logger?: Logger;
    fresh?: boolean;
  }): Promise<EncryptedFS> {
    if (db == null) {
      try {
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
          fresh,
        });
      } catch (e) {
        if (e instanceof dbErrors.ErrorDBKey) {
          throw new errors.ErrorEncryptedFSKey('Incorrect key supplied', {
            cause: e,
          });
        }
        throw e;
      }
    }
    iNodeMgr =
      iNodeMgr ??
      (await INodeManager.createINodeManager({
        db,
        logger: logger.getChild(INodeManager.name),
        fresh,
      }));
    const rootIno = await iNodeMgr.withNewINodeTransactionF(
      async (rootIno, tran) => {
        try {
          await iNodeMgr!.dirCreate(
            rootIno,
            {
              mode: permissions.DEFAULT_ROOT_PERM,
              uid: permissions.DEFAULT_ROOT_UID,
              gid: permissions.DEFAULT_ROOT_GID,
            },
            undefined,
            tran,
          );
        } catch (e) {
          if (e instanceof inodesErrors.ErrorINodesDuplicateRoot) {
            const root = await iNodeMgr!.dirGetRoot(tran);
            if (!root) {
              throw new inodesErrors.ErrorINodesIndexMissing(
                'Could not find pre-existing root INode, database may be corrupted',
                {
                  cause: e,
                },
              );
            }
            rootIno = root;
          } else {
            throw e;
          }
        }
        return rootIno;
      },
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
    await efs.start({ fresh });
    return efs;
  }

  public uid: number = permissions.DEFAULT_ROOT_UID;
  public gid: number = permissions.DEFAULT_ROOT_GID;
  public umask: number;
  public readonly blockSize: number;

  protected db: DB;
  protected iNodeMgr: INodeManager;
  protected fdMgr: FileDescriptorManager;
  protected logger: Logger;
  protected rootIno: INodeIndex;
  protected _cwd: CurrentDirectory;

  protected chroots: Set<EncryptedFS>;
  protected chrootParent?: EncryptedFS;

  constructor({
    db,
    iNodeMgr,
    fdMgr,
    rootIno,
    blockSize,
    umask,
    logger,
    chroots = new Set(),
    chrootParent,
  }: {
    db: DB;
    iNodeMgr: INodeManager;
    fdMgr: FileDescriptorManager;
    rootIno: INodeIndex;
    blockSize: number;
    umask: number;
    logger: Logger;
    chroots?: Set<EncryptedFS>;
    chrootParent?: EncryptedFS;
  }) {
    this.logger = logger;
    this.db = db;
    this.iNodeMgr = iNodeMgr;
    this.fdMgr = fdMgr;
    this.rootIno = rootIno;
    this.blockSize = blockSize;
    this.umask = umask;
    this.chroots = chroots;
    this.chrootParent = chrootParent;
    this._cwd = new CurrentDirectory(iNodeMgr, rootIno);
  }

  get cwd() {
    return this._cwd.path;
  }

  get constants() {
    return constants;
  }

  get promises() {
    return this;
  }

  public async start({
    fresh = false,
  }: {
    fresh?: boolean;
  } = {}): Promise<void> {
    this.logger.info(`Starting ${this.constructor.name}`);
    if (this.chrootParent == null) {
      await this.db.start({ fresh });
      await this.iNodeMgr.start({ fresh });
    } else {
      // If chrooted instance, add itself to the chroots set
      this.chroots.add(this);
    }
    this.logger.info(`Started ${this.constructor.name}`);
  }

  public async stop(): Promise<void> {
    this.logger.info(`Stopping ${this.constructor.name}`);
    if (this.chrootParent == null) {
      for (const efsChrooted of this.chroots) {
        await efsChrooted.stop();
      }
      await this.iNodeMgr.stop();
      await this.db.stop();
    } else {
      // If chrooted instance, delete itself from the chroots set
      this.chroots.delete(this);
    }
    this.logger.info(`Stopped ${this.constructor.name}`);
  }

  public async destroy(): Promise<void> {
    this.logger.info(`Destroying ${this.constructor.name}`);
    if (this.chrootParent == null) {
      // No need to destroy with `this.iNodeMgr.destroy()`
      // It would require restarting the DB
      // It is sufficient to only destroy the database
      await this.db.destroy();
    }
    // No destruction procedures for chrooted instances
    this.logger.info(`Destroyed ${this.constructor.name}`);
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
  @ready(new errors.ErrorEncryptedFSNotRunning(), true)
  public async chroot(
    path: string,
    callback?: Callback<[EncryptedFS]>,
  ): Promise<EncryptedFS | void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'chroot',
        });
      }
      await this.iNodeMgr.withTransactionF(target, async (tran) => {
        const targetData = await this.iNodeMgr.get(target, tran);
        if (targetData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'chroot',
          });
        }
        const targetType = targetData.type;
        if (!(targetType === 'Directory')) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOTDIR,
            path: path as string,
            syscall: 'chroot',
          });
        }
      });
      // Chrooted EFS shares all of the dependencies
      // This means the dependencies are already in running state
      const efsChrooted = new EncryptedFS({
        db: this.db,
        iNodeMgr: this.iNodeMgr,
        fdMgr: this.fdMgr,
        rootIno: target,
        blockSize: this.blockSize,
        umask: this.umask,
        logger: this.logger,
        chroots: this.chroots,
        chrootParent: this,
      });
      await efsChrooted.start();
      return efsChrooted;
    }, callback);
  }

  public async chdir(path: string): Promise<void>;
  public async chdir(path: string, callback: Callback): Promise<void>;
  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async chdir(path: string, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const navigated = await this.navigate(path, true);
      const target = navigated.target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
        });
      }
      await this.iNodeMgr.withTransactionF(target, async (tran) => {
        const targetData = await this.iNodeMgr.get(target, tran);
        if (targetData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'readdir',
          });
        }
        const targetType = targetData.type;
        if (!(targetType === 'Directory')) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOTDIR,
            path: path as string,
          });
        }
        const targetStat = await this.iNodeMgr.statGet(target, tran);
        if (!this.checkPermissions(constants.X_OK, targetStat)) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.EACCES,
            path: path as string,
          });
        }
        await this._cwd.changeDir(target, navigated.pathStack);
      });
    }, callback);
  }

  public async access(path: Path, mode?: number): Promise<void>;
  public async access(path: Path, callback: Callback): Promise<void>;
  public async access(
    path: Path,
    mode: number,
    callback: Callback,
  ): Promise<void>;
  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async access(
    path: Path,
    modeOrCallback: number | Callback = constants.F_OK,
    callback?: Callback,
  ): Promise<void> {
    const mode =
      typeof modeOrCallback !== 'function' ? modeOrCallback : constants.F_OK;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'access',
        });
      }
      await this.iNodeMgr.withTransactionF(async (tran) => {
        const targetData = await this.iNodeMgr.get(target, tran);
        if (targetData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'access',
          });
        }
        if (mode === constants.F_OK) {
          return;
        }
        const targetStat = await this.iNodeMgr.statGet(target, tran);
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      options.flag = 'a';
      let fdIndex: FdIndex | undefined;
      try {
        let fd: FileDescriptor | undefined;
        if (typeof file === 'number') {
          fd = this.fdMgr.getFd(file);
          if (!fd) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EBADF,
              syscall: 'appendFile',
            });
          }
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
          await fd.write(
            this.getBuffer(data, options.encoding),
            undefined,
            constants.O_APPEND,
          );
        } catch (e) {
          if (e instanceof RangeError) {
            throw new errors.ErrorEncryptedFSError(
              {
                errno: errno.EFBIG,
                syscall: 'appendFile',
              },
              { cause: e },
            );
          }
          throw e;
        }
      } finally {
        if (fdIndex !== undefined) await this.close(fdIndex);
      }
      return;
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async chmod(
    path: Path,
    mode: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'chmod',
        });
      }
      await this.iNodeMgr.withTransactionF(target, async (tran) => {
        const targetData = await this.iNodeMgr.get(target, tran);
        if (targetData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'chmod',
          });
        }
        const targetStat = await this.iNodeMgr.statGet(target, tran);
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
          target,
          'mode',
          (targetStat.mode & constants.S_IFMT) | mode,
          tran,
        );
      });
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async chown(
    path: Path,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'chown',
        });
      }
      await this.iNodeMgr.withTransactionF(target, async (tran) => {
        const targetData = await this.iNodeMgr.get(target, tran);
        if (targetData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'chown',
          });
        }
        const targetStat = await this.iNodeMgr.statGet(target, tran);
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
        await this.iNodeMgr.statSetProp(target, 'uid', uid, tran);
        await this.iNodeMgr.statSetProp(target, 'gid', gid, tran);
      });
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async chownr(
    path: Path,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      await this.chown(path, uid, gid);
      let children: Array<string | Buffer>;
      try {
        children = await this.readdir(path);
      } catch (e) {
        if (e && e.code === 'ENOTDIR') return;
        throw e;
      }
      for (const child of children) {
        const pathChild = utils.pathJoin(path as string, child.toString());
        // Don't traverse symlinks
        if (!(await this.lstat(pathChild)).isSymbolicLink()) {
          await this.chownr(pathChild, uid, gid);
        }
      }
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async close(fdIndex: FdIndex, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      srcPath = this.getPath(srcPath);
      dstPath = this.getPath(dstPath);
      let srcFd: FileDescriptor;
      let srcFdIndex: FdIndex | undefined;
      let dstFd: FileDescriptor;
      let dstFdIndex: FdIndex | undefined;
      try {
        // The only things that are copied is the data and the mode
        [srcFd, srcFdIndex] = await this._open(srcPath, constants.O_RDONLY);
        const srcINode = srcFd.ino;
        await this.iNodeMgr.withTransactionF(async (tran) => {
          const srcINodeData = await this.iNodeMgr.get(srcINode, tran);
          if (srcINodeData == null) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: srcPath as string,
              syscall: 'copyFile',
            });
          }
          const srcINodeStat = await this.iNodeMgr.statGet(srcINode, tran);
          if (srcINodeData.type === 'Directory') {
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
          const dstINodeType = (await this.iNodeMgr.get(dstINode, tran))?.type;
          if (dstINodeType === 'File') {
            let blkCounter = 0;
            for await (const block of this.iNodeMgr.fileGetBlocks(
              srcINode,
              this.blockSize,
              undefined,
              undefined,
              tran,
            )) {
              await this.iNodeMgr.fileSetBlocks(
                dstFd.ino,
                block,
                this.blockSize,
                blkCounter,
                tran,
              );
              blkCounter++;
            }
            // Setting the size
            const size = await this.iNodeMgr.statGetProp(
              srcINode,
              'size',
              tran,
            );
            const blocks = await this.iNodeMgr.statGetProp(
              srcINode,
              'blocks',
              tran,
            );
            await this.iNodeMgr.statSetProp(dstFd.ino, 'size', size, tran);
            await this.iNodeMgr.statSetProp(dstFd.ino, 'blocks', blocks, tran);
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

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public createReadStream(path: Path, options?: OptionsStream): ReadStream {
    const defaultOps: OptionsStream = {
      flags: 'r',
      encoding: undefined,
      fd: undefined,
      mode: permissions.DEFAULT_FILE_PERM,
      autoClose: true,
      end: Infinity,
    };
    const options_: OptionsStream = this.getOptions(defaultOps, options);
    path = this.getPath(path);
    if (options_.start !== undefined) {
      if (options_.start > (options_.end ?? Infinity)) {
        throw new RangeError('ERR_VALUE_OUT_OF_RANGE');
      }
    }
    return new ReadStream(path, options_, this);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public createWriteStream(path: Path, options?: OptionsStream): WriteStream {
    const defaultOps: OptionsStream = {
      flags: 'w',
      encoding: 'utf8',
      fd: undefined,
      mode: permissions.DEFAULT_FILE_PERM,
      autoClose: true,
    };
    const options_: OptionsStream = this.getOptions(defaultOps, options);
    path = this.getPath(path);
    if (options_.start !== undefined) {
      if (options_.start < 0) {
        throw new RangeError('ERR_VALUE_OUT_OF_RANGE');
      }
    }
    return new WriteStream(path, options_, this);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async exists(
    path: Path,
    callback?: Callback<[boolean]>,
  ): Promise<boolean | void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      try {
        return !!(await this.navigate(path, true)).target;
      } catch (e) {
        return false;
      }
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async fallocate(
    fdIndex: FdIndex,
    offset: number,
    len: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      if (offset < 0 || len <= 0) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EINVAL,
          syscall: 'fallocate',
        });
      }
      const fd = this.fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'fallocate',
        });
      }
      await this.iNodeMgr.withTransactionF(fd.ino, async (tran) => {
        const iNodeData = await this.iNodeMgr.get(fd.ino, tran);
        if (iNodeData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            syscall: 'fallocate',
          });
        }
        if (!(iNodeData.type === 'File')) {
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
            fd.ino,
            tran,
          );
          let newData: Buffer;
          try {
            newData = Buffer.concat([
              data,
              Buffer.alloc(offset + len - data.length),
            ]);
          } catch (e) {
            if (e instanceof RangeError) {
              throw new errors.ErrorEncryptedFSError(
                {
                  errno: errno.EFBIG,
                  syscall: 'fallocate',
                },
                { cause: e },
              );
            }
            throw e;
          }
          await this.iNodeMgr.fileSetBlocks(
            fd.ino,
            newData,
            this.blockSize,
            index,
            tran,
          );
          await this.iNodeMgr.statSetProp(fd.ino, 'size', newData.length, tran);
        }
        await this.iNodeMgr.statSetProp(fd.ino, 'ctime', new Date(), tran);
      });
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async fchmod(
    fdIndex: FdIndex,
    mode: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      const fd = this.fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'fchmod',
        });
      }
      await this.iNodeMgr.withTransactionF(fd.ino, async (tran) => {
        const iNodeData = await this.iNodeMgr.get(fd.ino, tran);
        if (iNodeData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            syscall: 'fchmod',
          });
        }
        const fdStat = await this.iNodeMgr.statGet(fd.ino, tran);
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
          fd.ino,
          'mode',
          (fdStat.mode & constants.S_IFMT) | mode,
          tran,
        );
      });
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async fchown(
    fdIndex: FdIndex,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      const fd = this.fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'fchown',
        });
      }
      await this.iNodeMgr.withTransactionF(fd.ino, async (tran) => {
        const iNodeData = await this.iNodeMgr.get(fd.ino, tran);
        if (iNodeData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            syscall: 'fchown',
          });
        }
        const fdStat = await this.iNodeMgr.statGet(fd.ino, tran);
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
        await this.iNodeMgr.statSetProp(fd.ino, 'uid', uid, tran);
        await this.iNodeMgr.statSetProp(fd.ino, 'gid', gid, tran);
      });
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async fdatasync(fdIndex: FdIndex, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async fstat(
    fdIndex: FdIndex,
    callback?: Callback<[Stat]>,
  ): Promise<Stat | void> {
    return utils.maybeCallback(async () => {
      const fd = this.fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'fstat',
        });
      }
      const fdStat = await this.iNodeMgr.withTransactionF(
        fd.ino,
        async (tran) => {
          const iNodeData = await this.iNodeMgr.get(fd.ino, tran);
          if (iNodeData == null) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              syscall: 'fstat',
            });
          }
          return await this.iNodeMgr.statGet(fd.ino, tran);
        },
      );
      return new Stat(fdStat);
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async fsync(fdIndex: FdIndex, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async ftruncate(
    fdIndex: FdIndex,
    lenOrCallback: number | Callback = 0,
    callback?: Callback,
  ): Promise<void> {
    const len = typeof lenOrCallback !== 'function' ? lenOrCallback : 0;
    callback = typeof lenOrCallback === 'function' ? lenOrCallback : callback;
    return utils.maybeCallback(async () => {
      if (len < 0) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EINVAL,
          syscall: 'ftruncate',
        });
      }
      let newData: Buffer;
      const fd = this.fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'ftruncate',
        });
      }
      await this.iNodeMgr.withTransactionF(fd.ino, async (tran) => {
        const iNodeData = await this.iNodeMgr.get(fd.ino, tran);
        if (iNodeData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            syscall: 'ftruncate',
          });
        }
        if (!(iNodeData.type === 'File')) {
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
          fd.ino,
          this.blockSize,
          undefined,
          undefined,
          tran,
        )) {
          data = Buffer.concat([data, block]);
        }
        try {
          if (len > data.length) {
            newData = Buffer.alloc(len);
            data.copy(newData, 0, 0, data.length);
            await this.iNodeMgr.fileSetBlocks(
              fd.ino,
              newData,
              this.blockSize,
              undefined,
              tran,
            );
          } else if (len < data.length) {
            newData = Buffer.allocUnsafe(len);
            data.copy(newData, 0, 0, len);
            // Clear all file blocks for this inode before setting new blocks
            await this.iNodeMgr.fileClearData(fd.ino, tran);
            await this.iNodeMgr.fileSetBlocks(
              fd.ino,
              newData,
              this.blockSize,
              undefined,
              tran,
            );
          } else {
            newData = data;
          }
        } catch (e) {
          if (e instanceof RangeError) {
            throw new errors.ErrorEncryptedFSError(
              {
                errno: errno.EFBIG,
                syscall: 'ftruncate',
              },
              { cause: e },
            );
          }
          throw e;
        }
        const now = new Date();
        await this.iNodeMgr.statSetProp(fd.ino, 'mtime', now, tran);
        await this.iNodeMgr.statSetProp(fd.ino, 'ctime', now, tran);
        await this.iNodeMgr.statSetProp(fd.ino, 'size', newData.length, tran);
        await fd.setPos(Math.min(newData.length, fd.pos), undefined, tran);
      });
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async futimes(
    fdIndex: FdIndex,
    atime: number | string | Date,
    mtime: number | string | Date,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      const fd = this.fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'futimes',
        });
      }
      await this.iNodeMgr.withTransactionF(fd.ino, async (tran) => {
        const iNodeData = await this.iNodeMgr.get(fd.ino, tran);
        if (iNodeData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            syscall: 'futimes',
          });
        }
        let newAtime: Date;
        let newMtime: Date;
        if (typeof atime === 'number') {
          newAtime = new Date(atime * 1000);
        } else if (typeof atime === 'string') {
          newAtime = new Date(parseInt(atime) * 1000);
        } else {
          newAtime = atime;
        }
        if (typeof mtime === 'number') {
          newMtime = new Date(mtime * 1000);
        } else if (typeof mtime === 'string') {
          newMtime = new Date(parseInt(mtime) * 1000);
        } else {
          newMtime = mtime;
        }
        await this.iNodeMgr.statSetProp(fd.ino, 'atime', newAtime, tran);
        await this.iNodeMgr.statSetProp(fd.ino, 'mtime', newMtime, tran);
        await this.iNodeMgr.statSetProp(fd.ino, 'ctime', new Date(), tran);
      });
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async lchmod(
    path: Path,
    mode: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'lchmod',
        });
      }
      await this.iNodeMgr.withTransactionF(target, async (tran) => {
        const targetData = await this.iNodeMgr.get(target, tran);
        if (targetData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'lchmod',
          });
        }
        const targetStat = await this.iNodeMgr.statGet(target, tran);
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
          target,
          'mode',
          (targetStat.mode & constants.S_IFMT) | mode,
          tran,
        );
      });
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async lchown(
    path: Path,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'lchown',
        });
      }
      await this.iNodeMgr.withTransactionF(target, async (tran) => {
        const targetData = await this.iNodeMgr.get(target, tran);
        if (targetData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'lchown',
          });
        }
        const targetStat = await this.iNodeMgr.statGet(target, tran);
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
        await this.iNodeMgr.statSetProp(target, 'uid', uid, tran);
        await this.iNodeMgr.statSetProp(target, 'gid', gid, tran);
      });
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async link(
    existingPath: Path,
    newPath: Path,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      existingPath = this.getPath(existingPath);
      newPath = this.getPath(newPath);
      const navigatedExisting = await this.navigate(existingPath, false);
      const navigatedNew = await this.navigate(newPath, false);
      const existingTarget = navigatedExisting.target;
      if (existingTarget == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: existingPath as string,
          dest: newPath as string,
          syscall: 'link',
        });
      }
      await this.iNodeMgr.withTransactionF(
        existingTarget,
        navigatedNew.dir,
        async (tran) => {
          const iNodeData = await this.iNodeMgr.get(existingTarget, tran);
          if (iNodeData == null) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              syscall: 'link',
            });
          }
          const existingTargetType = (
            await this.iNodeMgr.get(existingTarget, tran)
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
              navigatedNew.dir,
              tran,
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
              navigatedExisting.dir,
              navigatedExisting.name,
              tran,
            );
            await this.iNodeMgr.dirSetEntry(
              navigatedNew.dir,
              navigatedNew.name,
              index as INodeIndex,
              tran,
            );
            await this.iNodeMgr.statSetProp(
              existingTarget,
              'ctime',
              new Date(),
              tran,
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      const fd = this.fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBADF,
          syscall: 'lseek',
        });
      }
      await this.iNodeMgr.withTransactionF(fd.ino, async (tran) => {
        const iNodeData = await this.iNodeMgr.get(fd.ino, tran);
        if (iNodeData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            syscall: 'lseek',
          });
        }
        if (
          [constants.SEEK_SET, constants.SEEK_CUR, constants.SEEK_END].indexOf(
            seekFlags,
          ) === -1
        ) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.EINVAL,
            syscall: 'lseek',
          });
        }
        await fd.setPos(position, seekFlags, tran);
      });
      return fd.pos;
    }, callback);
  }

  public async lstat(path: Path): Promise<Stat>;
  public async lstat(path: Path, callback: Callback<[Stat]>): Promise<void>;
  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async lstat(
    path: Path,
    callback?: Callback<[Stat]>,
  ): Promise<Stat | void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'lstat',
        });
      }
      const targetStat = await this.iNodeMgr.withTransactionF(
        target,
        async (tran) => {
          const targetData = await this.iNodeMgr.get(target, tran);
          if (targetData == null) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'lstat',
            });
          }
          return await this.iNodeMgr.statGet(target, tran);
        },
      );
      return new Stat({ ...targetStat });
    }, callback);
  }

  /**
   * Makes a directory
   *
   * This call must handle concurrent races to create the directory inode
   */
  public async mkdir(path: Path, options?: Options | number): Promise<void>;
  public async mkdir(path: Path, callback: Callback): Promise<void>;
  public async mkdir(
    path: Path,
    options: Options | number,
    callback: Callback,
  ): Promise<void>;
  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async mkdir(
    path: Path,
    optionsOrCallback: Options | number | Callback = {},
    callback?: Callback,
  ): Promise<void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? typeof optionsOrCallback === 'number'
          ? this.getOptions({ mode: optionsOrCallback, recursive: false }, {})
          : this.getOptions(
              { mode: permissions.DEFAULT_DIRECTORY_PERM, recursive: false },
              optionsOrCallback,
            )
        : ({
            mode: permissions.DEFAULT_DIRECTORY_PERM,
            recursive: false,
          } as Options);
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      // If the path has trailing slashes, navigation would traverse into it
      // we must trim off these trailing slashes to allow these directories to be removed
      path = path.replace(/(.+?)\/+$/, '$1');
      let navigated = await this.navigate(path, false);
      // Mutable transaction contexts may be inherited across loop iterations
      // During concurrent mkdir calls, calls race to create the inode
      // One call will win the lock to create the inode, all other calls must coalesce
      // Coalescing calls must handle the now existing target, to do so
      // It must continue the loop, by restarting the loop with an inherited transaction context
      // This ensures that handling the existing inode is consistent
      let tran: DBTransaction | null = null;
      let tranRelease: ResourceRelease | null = null;
      // Loop necessary due to recursive directory creation
      while (true) {
        if (navigated.target != null) {
          // Handle existing target
          if (tran == null || tranRelease == null) {
            const tranAcquire = this.iNodeMgr.transaction(navigated.target);
            [tranRelease, tran] = (await tranAcquire()) as [
              ResourceRelease,
              DBTransaction,
            ];
          }
          let e: Error | undefined;
          try {
            const targetType = (await this.iNodeMgr.get(navigated.target, tran))
              ?.type;
            // If recursive, then loop through the path components
            if (!(targetType === 'Directory' && options.recursive)) {
              // Target already exists
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EEXIST,
                path: path as string,
                syscall: 'mkdir',
              });
            }
            // No more path components to process
            if (!navigated.remaining) {
              return;
            }
            // Continue the navigation process
            navigated = await this.navigateFrom(
              navigated.target,
              navigated.remaining,
              true,
              undefined,
              undefined,
              undefined,
              // Preserve the transaction context for `navigated.target`
              tran,
            );
            // Restart the opening procedure with the new target
          } catch (e_) {
            e = e_;
            throw e_;
          } finally {
            await tranRelease(e);
            // Clear the transaction variables
            tran = null;
            tranRelease = null;
          }
        } else {
          // Handle non-existing target
          if (navigated.remaining && !options.recursive) {
            // Intermediate path component does not exist
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'mkdir',
            });
          }
          const inoAcquire = this.iNodeMgr.inoAllocation(navigated);
          const [inoRelease, ino] = (await inoAcquire()) as [
            ResourceRelease,
            INodeIndex,
          ];
          const tranAcquire = this.iNodeMgr.transaction(ino, navigated.dir);
          [tranRelease, tran] = (await tranAcquire()) as [
            ResourceRelease,
            DBTransaction,
          ];
          // INode may be created while waiting for lock
          // Transaction is maintained and not released
          // This is to ensure that the already created locks are held
          if ((await this.iNodeMgr.get(ino, tran)) != null) {
            navigated.target = ino;
            await inoRelease();
            continue;
          }
          let e: Error | undefined;
          try {
            const navigatedDirStat = await this.iNodeMgr.statGet(
              navigated.dir,
              tran,
            );
            if (navigatedDirStat.nlink < 2) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.ENOENT,
                path: path as string,
                syscall: 'mkdir',
              });
            }
            if (!this.checkPermissions(constants.W_OK, navigatedDirStat)) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EACCES,
                path: path as string,
                syscall: 'mkdir',
              });
            }
            await this.iNodeMgr.dirCreate(
              ino,
              {
                mode: utils.applyUmask(
                  options.mode ?? permissions.DEFAULT_DIRECTORY_PERM,
                  this.umask,
                ),
                uid: this.uid,
                gid: this.gid,
              },
              navigated.dir,
              tran,
            );
            await this.iNodeMgr.dirSetEntry(
              navigated.dir,
              navigated.name,
              ino,
              tran,
            );
          } catch (e_) {
            e = e_;
            throw e_;
          } finally {
            await tranRelease(e);
            await inoRelease(e);
            // Clear the transaction variables
            tran = null;
            tranRelease = null;
          }
          // No more path components to process
          if (!navigated.remaining) {
            return;
          }
          // Continue the navigation process
          navigated = await this.navigateFrom(ino, navigated.remaining, true);
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      if (!pathSPrefix || typeof pathSPrefix !== 'string') {
        throw new TypeError('filename prefix is required');
      }
      const getChar = () => {
        const possibleChars =
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return possibleChars[Math.floor(Math.random() * possibleChars.length)];
      };
      let pathS: string;
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

  /**
   * Makes an inode
   *
   * This call must handle concurrent races to create the inode
   */
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      path = this.getPath(path);
      const navigated = await this.navigate(path, false);
      if (navigated.target != null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EEXIST,
          path: path as string,
          syscall: 'mknod',
        });
      }
      await this.iNodeMgr.withNewINodeTransactionF(
        navigated,
        navigated.dir,
        async (ino, tran) => {
          // INode may be created while waiting for lock
          if ((await this.iNodeMgr.get(ino, tran)) != null) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EEXIST,
              path: path as string,
              syscall: 'mknod',
            });
          }
          const navigatedDirStat = await this.iNodeMgr.statGet(
            navigated.dir,
            tran,
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
                ino,
                {
                  mode: utils.applyUmask(mode, this.umask),
                  uid: this.uid,
                  gid: this.gid,
                },
                this.blockSize,
                undefined,
                tran,
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
            navigated.dir,
            navigated.name,
            ino,
            tran,
          );
        },
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      return (await this._open(path, flags, mode))[1];
    }, callback);
  }

  /**
   * This call must handle concurrent races to create the file inode
   */
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
    // Creates the file descriptor, used at the very end
    const createFd = async (
      flags: number,
      target: INodeIndex,
      tran: DBTransaction,
    ) => {
      // Convert file descriptor flags into bitwise permission flags
      let access: number;
      if (flags & constants.O_RDWR) {
        access = constants.R_OK | constants.W_OK;
      } else if ((flags & constants.O_WRONLY) | (flags & constants.O_TRUNC)) {
        access = constants.W_OK;
      } else {
        access = constants.R_OK;
      }
      // Check the permissions
      const targetStat = await this.iNodeMgr.statGet(target, tran);
      if (!this.checkPermissions(access, targetStat)) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EACCES,
          path: path as string,
          syscall: 'open',
        });
      }
      // Returns the created FileDescriptor
      try {
        return await this.fdMgr.createFd(target, flags);
      } catch (e) {
        if (e instanceof errors.ErrorEncryptedFSError) {
          e.setPaths(path as string);
          e.setSyscall('open');
        }
        throw e;
      }
    };
    let navigated = await this.navigate(path, false);
    // Mutable transaction contexts may be inherited across loop iterations
    // During concurrent open calls with `O_CREAT`, calls may race to create the inode
    // One call will win the lock to create the inode, all other calls must coalesce
    // Coalescing calls must handle the now existing target, to do so
    // It must continue the loop, by restarting the loop with an inherited transaction context
    // This ensures that handling the existing inode is consistent
    let raced = false;
    let tran: DBTransaction | null = null;
    let tranRelease: ResourceRelease | null = null;
    // Loop necessary due to following symlinks and optional `O_CREAT` file creation
    while (true) {
      if (navigated.target != null) {
        // Handle existing target
        if (tran == null || tranRelease == null) {
          const tranAcquire = this.iNodeMgr.transaction(navigated.target);
          [tranRelease, tran] = (await tranAcquire()) as [
            ResourceRelease,
            DBTransaction,
          ];
        }
        let e: Error | undefined;
        try {
          const target = await this.iNodeMgr.get(navigated.target, tran);
          if (target == null) {
            // Try to find the target again
            navigated = await this.navigate(path, false);
            continue;
          }
          const targetType = target.type;
          if (targetType === 'Symlink') {
            // Cannot be symlink if O_NOFOLLOW
            if (flags & constants.O_NOFOLLOW) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.ELOOP,
                path: path as string,
                syscall: 'open',
              });
            }
            // Follow the symlink
            navigated = await this.navigateFrom(
              navigated.dir,
              navigated.name + navigated.remaining,
              true,
              undefined,
              undefined,
              path,
              // Only preserve the transaction context if it was inherited
              // from a coalesced call, as it would already have be for `navigated.dir`
              raced ? tran : undefined,
            );
            // Restart the opening procedure with the new target
            continue;
          } else {
            // Target already exists cannot be created exclusively
            if (flags & constants.O_CREAT && flags & constants.O_EXCL) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EEXIST,
                path: path as string,
                syscall: 'open',
              });
            }
            // Cannot be directory if write capabilities are requested
            if (
              targetType === 'Directory' &&
              flags &
                (constants.O_WRONLY |
                  (flags & (constants.O_RDWR | (flags & constants.O_TRUNC))))
            ) {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.EISDIR,
                path: path as string,
                syscall: 'open',
              });
            }
            // Must be directory if O_DIRECTORY
            if (flags & constants.O_DIRECTORY && targetType !== 'Directory') {
              throw new errors.ErrorEncryptedFSError({
                errno: errno.ENOTDIR,
                path: path as string,
                syscall: 'open',
              });
            }
            // Must truncate a file if O_TRUNC
            if (
              targetType === 'File' &&
              flags & constants.O_TRUNC &&
              flags & (constants.O_WRONLY | constants.O_RDWR)
            ) {
              await this.iNodeMgr.fileClearData(navigated.target, tran);
              await this.iNodeMgr.fileSetBlocks(
                navigated.target,
                Buffer.alloc(0),
                this.blockSize,
                undefined,
                tran,
              );
            }
            // Terminates loop, creates file descriptor
            return await createFd(flags, navigated.target, tran!);
          }
        } catch (e_) {
          e = e_;
          throw e_;
        } finally {
          await tranRelease(e);
          // Clear the transaction variables
          tran = null;
          tranRelease = null;
        }
      } else {
        // Handle non-existing target
        if (navigated.remaining || !(flags & constants.O_CREAT)) {
          // Intermediate path component does not exist
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'open',
          });
        }
        const inoAcquire = this.iNodeMgr.inoAllocation(navigated);
        const [inoRelease, ino] = (await inoAcquire()) as [
          ResourceRelease,
          INodeIndex,
        ];
        const tranAcquire = this.iNodeMgr.transaction(ino, navigated.dir);
        [tranRelease, tran] = (await tranAcquire()) as [
          ResourceRelease,
          DBTransaction,
        ];
        // INode may be created while waiting for lock
        // Transaction is maintained and not released
        // This is to ensure that the already created locks are held
        if ((await this.iNodeMgr.get(ino, tran)) != null) {
          navigated.target = ino;
          await inoRelease();
          raced = true;
          continue;
        }
        let e: Error | undefined;
        try {
          const navigatedDirStat = await this.iNodeMgr.statGet(
            navigated.dir,
            tran,
          );
          // Cannot create if the current directory has been unlinked from its parent directory
          if (navigatedDirStat.nlink < 2) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'open',
            });
          }
          if (!this.checkPermissions(constants.W_OK, navigatedDirStat)) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EACCES,
              path: path as string,
              syscall: 'open',
            });
          }
          await this.iNodeMgr.fileCreate(
            ino!,
            {
              mode: utils.applyUmask(mode, this.umask),
              uid: this.uid,
              gid: this.gid,
            },
            this.blockSize,
            undefined,
            tran,
          );
          await this.iNodeMgr.dirSetEntry(
            navigated.dir,
            navigated.name,
            ino!,
            tran,
          );
          // Terminates loop, creates file descriptor
          return await createFd(flags, ino!, tran!);
        } catch (e_) {
          e = e_;
          throw e_;
        } finally {
          await tranRelease(e);
          await inoRelease(e);
          // Clear the transaction variables
          tran = null;
          tranRelease = null;
        }
      }
    }
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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

      return await this.iNodeMgr.withTransactionF(fd.ino, async (tran) => {
        const iNodeData = await this.iNodeMgr.get(fd.ino, tran);
        if (iNodeData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            syscall: 'read',
          });
        }
        const fdStat = await this.iNodeMgr.statGet(fd.ino, tran);
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
        let bytesRead: number;
        try {
          bytesRead = await fd.read(buffer as Buffer, position, tran);
        } catch (e) {
          if (e instanceof errors.ErrorEncryptedFSError) {
            e.setSyscall('read');
          }
          throw e;
        }
        return bytesRead;
      });
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'readdir',
        });
      }
      const navigatedTargetEntries: Array<[string | Buffer, INodeIndex]> = [];
      await this.iNodeMgr.withTransactionF(target, async (tran) => {
        const navigatedTargetData = await this.iNodeMgr.get(target!, tran);
        if (navigatedTargetData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'readdir',
          });
        }
        const navigatedTargetType = navigatedTargetData.type;
        if (navigatedTargetType !== 'Directory') {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOTDIR,
            path: path as string,
            syscall: 'readdir',
          });
        }
        const navigatedTargetStat = await this.iNodeMgr.statGet(target!, tran);
        if (!this.checkPermissions(constants.R_OK, navigatedTargetStat)) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.EACCES,
            path: path as string,
            syscall: 'readdir',
          });
        }
        for await (const dirEntry of this.iNodeMgr.dirGet(target!, tran)) {
          navigatedTargetEntries.push(dirEntry);
        }
      });
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      options.flag = 'r';
      let fdIndex: FdIndex | undefined;
      try {
        const buffer = Buffer.allocUnsafe(this.blockSize);
        let totalBuffer = Buffer.alloc(0);
        let bytesRead: number | undefined = undefined;
        if (typeof file !== 'number') {
          fdIndex = await this.open(file, options.flag);
          file = fdIndex;
        }
        while (bytesRead !== 0) {
          bytesRead = await this.read(file, buffer, 0, buffer.length);
          totalBuffer = Buffer.concat([
            totalBuffer,
            buffer.slice(0, bytesRead),
          ]);
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'readlink',
        });
      }
      const link = await this.iNodeMgr.withTransactionF(
        target,
        async (tran) => {
          const targetData = await this.iNodeMgr.get(target, tran);
          if (targetData == null) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'readlink',
            });
          }
          const targetType = (await this.iNodeMgr.get(target, tran))?.type;
          if (!(targetType === 'Symlink')) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EINVAL,
              path: path as string,
              syscall: 'readlink',
            });
          }
          return await this.iNodeMgr.symlinkGetLink(target, tran);
        },
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      path = this.getPath(path);
      const navigated = await this.navigate(path, true);
      if (navigated.target == null) {
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

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async rename(
    oldPath: Path,
    newPath: Path,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      oldPath = this.getPath(oldPath);
      newPath = this.getPath(newPath);
      const navigatedSource = await this.navigate(oldPath, false);
      const navigatedTarget = await this.navigate(newPath, false);
      if (navigatedSource.target == null || navigatedTarget.remaining) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: oldPath as string,
          dest: newPath as string,
          syscall: 'rename',
        });
      }
      // Listing iNodes to lock
      const iNodes = [
        navigatedSource.dir,
        navigatedSource.target,
        // Avoid duplicate dir inodes
        ...(navigatedSource.dir !== navigatedTarget.dir
          ? [navigatedTarget.dir]
          : []),
        // Locking target if it exists
        ...(navigatedTarget.target != null ? [navigatedTarget.target] : []),
      ];
      const sourceTarget = navigatedSource.target;
      await this.iNodeMgr.withTransactionF(...iNodes, async (tran) => {
        // Check path or target
        const sourceTargetData = await this.iNodeMgr.get(sourceTarget, tran);
        if (sourceTargetData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: oldPath as string,
            dest: newPath as string,
            syscall: 'rename',
          });
        }
        if (sourceTargetData.type === 'Directory') {
          // If oldPath is a directory, target must be a directory (if it exists)
          if (navigatedTarget.target) {
            const targetTargetType = (
              await this.iNodeMgr.get(navigatedTarget.target, tran)
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
              navigatedTarget.target,
              tran,
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
            navigatedSource.pathStack.length < navigatedTarget.pathStack.length
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
              await this.iNodeMgr.get(navigatedTarget.target, tran)
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
          navigatedSource.dir,
          tran,
        );
        const targetDirStat = await this.iNodeMgr.statGet(
          navigatedTarget.dir,
          tran,
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
              navigatedSource.dir,
              navigatedSource.name,
              navigatedTarget.name,
              tran,
            );
          } catch (e) {
            if (e instanceof inodesErrors.ErrorINodesInvalidName) {
              throw new errors.ErrorEncryptedFSError(
                {
                  errno: errno.ENOENT,
                  path: oldPath as string,
                  dest: newPath as string,
                  syscall: 'rename',
                },
                { cause: e },
              );
            }
            throw e;
          }
          return;
        }
        const index = (await this.iNodeMgr.dirGetEntry(
          navigatedSource.dir,
          navigatedSource.name,
          tran,
        )) as INodeIndex;
        const now = new Date();
        if (navigatedTarget.target) {
          await this.iNodeMgr.statSetProp(
            navigatedTarget.target,
            'ctime',
            now,
            tran,
          );
          await this.iNodeMgr.dirUnsetEntry(
            navigatedTarget.dir,
            navigatedTarget.name,
            tran,
          );
          await this.iNodeMgr.dirSetEntry(
            navigatedTarget.dir,
            navigatedTarget.name,
            index,
            tran,
          );
          await this.iNodeMgr.statSetProp(
            navigatedTarget.target,
            'ctime',
            now,
            tran,
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
            navigatedTarget.dir,
            navigatedTarget.name,
            index,
            tran,
          );
        }
        await this.iNodeMgr.statSetProp(sourceTarget, 'ctime', now, tran);
        await this.iNodeMgr.dirUnsetEntry(
          navigatedSource.dir,
          navigatedSource.name,
          tran,
        );
      });
    }, callback);
  }

  public async rmdir(path: Path, options?: Options): Promise<void>;
  public async rmdir(path: Path, callback: Callback): Promise<void>;
  public async rmdir(
    path: Path,
    options: Options,
    callback: Callback,
  ): Promise<void>;
  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async rmdir(
    path: Path,
    optionsOrCallback: Options | Callback = {},
    callback?: Callback,
  ): Promise<void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? this.getOptions({ recursive: false }, optionsOrCallback)
        : { recursive: false };
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      // If the path has trailing slashes, navigation would traverse into it
      // we must trim off these trailing slashes to allow these directories to be removed
      path = path.replace(/(.+?)\/+$/, '$1');
      const navigated = await this.navigate(path, false);
      // This is for if the path resolved to root
      if (!navigated.name) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EBUSY,
          path: path as string,
          syscall: 'rmdir',
        });
      }
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
      if (navigated.target == null) {
        // If recursive, then this is acceptable
        if (options.recursive) {
          return;
        }
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'rmdir',
        });
      }
      const tranAcquire = this.iNodeMgr.transaction(
        navigated.target,
        navigated.dir,
      );
      const [tranRelease, tran] = await tranAcquire();
      const targetEntries: Array<[string, INodeIndex]> = [];
      let e: Error | undefined;
      try {
        // Handle existing target
        const target = navigated.target as INodeIndex;
        const targetType = (await this.iNodeMgr.get(target, tran))?.type;
        if (targetType == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'rmdir',
          });
        }
        if (targetType !== 'Directory') {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOTDIR,
            path: path as string,
            syscall: 'rmdir',
          });
        }
        // EACCES is thrown when write permission is denied on parent directory
        const navigatedDirStat = await this.iNodeMgr.statGet(
          navigated.dir,
          tran,
        );
        if (!this.checkPermissions(constants.W_OK, navigatedDirStat)) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.EACCES,
            path: path as string,
            syscall: 'mkdir',
          });
        }
        for await (const entry of this.iNodeMgr.dirGet(target, tran)) {
          targetEntries.push(entry);
        }
        // If 2 entries (`.` and `..`), then it is an empty directory
        if (targetEntries.length === 2) {
          await this.iNodeMgr.dirUnsetEntry(
            navigated.dir,
            navigated.name,
            tran,
          );
          // Finished deletion
          return;
        }
        // Directory is not-empty, and if it is non-recursive, then this is an error
        if (!options.recursive) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOTEMPTY,
            path: path as string,
            syscall: 'rmdir',
          });
        }
      } catch (e_) {
        e = e_;
        throw e_;
      } finally {
        await tranRelease(e);
      }
      // Now we recursively delete our entries
      // each deletion occurs within their own transaction context
      for (const [entryName] of targetEntries) {
        if (entryName === '.' || entryName === '..') {
          continue;
        }
        const entryPath = utils.pathJoin(path, entryName);
        try {
          await this.unlink(entryPath);
        } catch (e) {
          if (!(e instanceof errors.ErrorEncryptedFSError)) {
            throw e;
          }
          if (e.code === errno.EISDIR.code) {
            // Is a directory, propagate recursive deletion
            await this.rmdir(entryPath, options);
          } else {
            throw e;
          }
        }
      }
      // After deleting all entries, attempt to delete the same directory again
      await this.rmdir(path, options);
    }, callback);
  }

  public async stat(path: Path): Promise<Stat>;
  public async stat(path: Path, callback: Callback<[Stat]>): Promise<void>;
  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async stat(
    path: Path,
    callback?: Callback<[Stat]>,
  ): Promise<Stat | void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'stat',
        });
      }
      const targetStat = await this.iNodeMgr.withTransactionF(
        target,
        async (tran) => {
          const targetData = await this.iNodeMgr.get(target, tran);
          if (targetData == null) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'stat',
            });
          }
          return await this.iNodeMgr.statGet(target, tran);
        },
      );
      return new Stat({ ...targetStat });
    }, callback);
  }

  /**
   * Makes a symlink
   *
   * This call must handle concurrent races to create the symlink inode
   */
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async symlink(
    dstPath: Path,
    srcPath: Path,
    typeOrCallback: string | Callback = 'file',
    callback?: Callback,
  ): Promise<void> {
    callback = typeof typeOrCallback === 'function' ? typeOrCallback : callback;
    return utils.maybeCallback(async () => {
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
      if (navigated.target != null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.EEXIST,
          path: srcPath as string,
          dest: dstPath as string,
          syscall: 'symlink',
        });
      }
      await this.iNodeMgr.withNewINodeTransactionF(
        navigated,
        navigated.dir,
        async (symlinkIno, tran) => {
          // INode may be created while waiting for lock
          if ((await this.iNodeMgr.get(symlinkIno, tran)) != null) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.EEXIST,
              path: srcPath as string,
              dest: dstPath as string,
              syscall: 'symlink',
            });
          }
          const dirStat = await this.iNodeMgr.statGet(navigated.dir, tran);
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
            symlinkIno,
            {
              mode: permissions.DEFAULT_SYMLINK_PERM,
              uid: this.uid,
              gid: this.gid,
            },
            dstPath as string,
            tran,
          );
          await this.iNodeMgr.dirSetEntry(
            navigated.dir,
            navigated.name,
            symlinkIno,
            tran,
          );
        },
      );
    }, callback);
  }

  public async truncate(file: File, len?: number): Promise<void>;
  public async truncate(file: File, callback: Callback): Promise<void>;
  public async truncate(
    file: File,
    len: number,
    callback: Callback,
  ): Promise<void>;
  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async truncate(
    file: File,
    lenOrCallback: number | Callback = 0,
    callback?: Callback,
  ): Promise<void> {
    const len = typeof lenOrCallback !== 'function' ? lenOrCallback : 0;
    callback = typeof lenOrCallback === 'function' ? lenOrCallback : callback;
    return utils.maybeCallback(async () => {
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
        let fdIndex: FdIndex | undefined;
        try {
          fdIndex = await this.open(file, constants.O_WRONLY);
          await this.ftruncate(fdIndex, len);
        } finally {
          if (fdIndex !== undefined) await this.close(fdIndex);
        }
      }
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async unlink(path: Path, callback?: Callback): Promise<void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const navigated = await this.navigate(path, false);
      if (navigated.target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'unlink',
        });
      }
      const target = navigated.target;
      await this.iNodeMgr.withTransactionF(
        ...(navigated.dir === navigated.target
          ? [navigated.dir]
          : [navigated.dir, navigated.target]),
        async (tran) => {
          const targetData = await this.iNodeMgr.get(target, tran);
          if (targetData == null) {
            throw new errors.ErrorEncryptedFSError({
              errno: errno.ENOENT,
              path: path as string,
              syscall: 'unlink',
            });
          }
          const dirStat = await this.iNodeMgr.statGet(navigated.dir, tran);
          const targetType = (await this.iNodeMgr.get(target, tran))?.type;
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
          await this.iNodeMgr.statSetProp(target, 'ctime', now, tran);
          await this.iNodeMgr.dirUnsetEntry(
            navigated.dir,
            navigated.name,
            tran,
          );
        },
      );
    }, callback);
  }

  @ready(new errors.ErrorEncryptedFSNotRunning())
  public async utimes(
    path: Path,
    atime: number | string | Date,
    mtime: number | string | Date,
    callback?: Callback,
  ): Promise<void> {
    return utils.maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (target == null) {
        throw new errors.ErrorEncryptedFSError({
          errno: errno.ENOENT,
          path: path as string,
          syscall: 'utimes',
        });
      }
      await this.iNodeMgr.withTransactionF(target, async (tran) => {
        const targetData = await this.iNodeMgr.get(target, tran);
        if (targetData == null) {
          throw new errors.ErrorEncryptedFSError({
            errno: errno.ENOENT,
            path: path as string,
            syscall: 'utimes',
          });
        }
        let newAtime: Date;
        let newMtime: Date;
        if (typeof atime === 'number') {
          newAtime = new Date(atime * 1000);
        } else if (typeof atime === 'string') {
          newAtime = new Date(parseInt(atime) * 1000);
        } else {
          newAtime = atime;
        }
        if (typeof mtime === 'number') {
          newMtime = new Date(mtime * 1000);
        } else if (typeof mtime === 'string') {
          newMtime = new Date(parseInt(mtime) * 1000);
        } else {
          newMtime = mtime;
        }
        await this.iNodeMgr.statSetProp(target, 'atime', newAtime, tran);
        await this.iNodeMgr.statSetProp(target, 'mtime', newMtime, tran);
        await this.iNodeMgr.statSetProp(target, 'ctime', new Date(), tran);
      });
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      let buffer: Buffer;
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
          throw new errors.ErrorEncryptedFSError(
            {
              errno: errno.EFBIG,
              syscall: 'write',
            },
            { cause: e },
          );
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
  @ready(new errors.ErrorEncryptedFSNotRunning())
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
      let fdIndex: FdIndex;
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
   *   target == null => Non-existent segment
   *   name === ''    => Target is at root
   *   name === '.'   => dir is the same as target
   *   name === '..'  => dir is a child directory
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
   * You should not use this directly unless you first call _navigate
   * and pass the remaining path to _navigateFrom.
   * Note that the pathStack is always the full path to the target.
   *
   * Each navigateFrom call usually has its own transaction context
   * It does not preserve transaction context on recursive calls
   * to `this.navigate` or `this.navigateFrom`.
   * This is because navigation on from a particular inode is a
   * self-contained operation.
   *
   * Callers must pass an existing transaction context if they are navigating
   * from an inode that was just created within that transaction context, this
   * is necessary because otherwise there will be a deadlock when
   * `this.navigateFrom` starts their own transaction context on that inode
   */
  protected async navigateFrom(
    curdir: INodeIndex,
    pathS: string,
    resolveLastLink: boolean = true,
    activeSymlinks: Set<INodeIndex> = new Set(),
    pathStack: Array<string> = [],
    origPathS: string = pathS,
    tran?: DBTransaction,
  ): Promise<Navigated> {
    // If pathS is empty, there is nothing from the curdir to navigate to
    if (!pathS) {
      throw new errors.ErrorEncryptedFSError({
        errno: errno.ENOENT,
        path: origPathS,
      });
    }
    // Only commit the transaction if this call created the transaction
    let tranRelease: ResourceRelease | undefined;
    if (tran == null) {
      const tranAcquire = this.iNodeMgr.transaction(curdir);
      [tranRelease, tran] = (await tranAcquire()) as [
        ResourceRelease,
        DBTransaction,
      ];
    }
    const curDirData = this.iNodeMgr.get(curdir, tran);
    if (curDirData == null) {
      throw new errors.ErrorEncryptedFSError({
        errno: errno.ENOENT,
      });
    }
    let targetType: INodeType;
    let nextDir: INodeIndex | undefined;
    let nextPath: string;
    let e: Error | undefined;
    try {
      const curdirStat = await this.iNodeMgr.statGet(curdir, tran);
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
      let target: INodeIndex | undefined;
      if (parse.segment === '..' && curdir === this.rootIno) {
        // At the root directory, `..` refers back to the root inode
        target = curdir;
      } else {
        // Acquire the target inode for the entry
        target = await this.iNodeMgr.dirGetEntry(curdir, parse.segment, tran);
      }
      if (target == null) {
        // Target does not exist, return an `undefined` target
        return {
          dir: curdir,
          target: undefined,
          name: parse.segment,
          remaining: parse.rest,
          pathStack: pathStack,
        };
      }
      // If the target exists, then the the target type must exist in the same transaction
      targetType = (await this.iNodeMgr.get(target, tran))!.type;
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
            const targetLink = await this.iNodeMgr.symlinkGetLink(target, tran);
            nextPath = utils.pathJoin(targetLink, parse.rest);
            if (nextPath[0] !== '/') {
              pathStack.pop();
              nextDir = curdir;
            }
          }
          break;
      }
    } catch (e_) {
      e = e_;
      throw e_;
    } finally {
      if (tranRelease != null) {
        await tranRelease(e);
      }
    }
    if (targetType === 'Symlink' && nextPath[0] === '/') {
      // Only symlinks can have absolute next paths
      // in which case we start the navigate from the root
      return this.navigate(
        nextPath,
        resolveLastLink,
        activeSymlinks,
        origPathS,
      );
    } else {
      // Otherwise we are navigating relative to the `nextDir`
      return this.navigateFrom(
        nextDir!,
        nextPath,
        resolveLastLink,
        activeSymlinks,
        pathStack,
        origPathS,
      );
    }
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
    if (typeof path === 'object') {
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
      recursive?: boolean;
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
    return Buffer.from(data, encoding);
  }
}

export default EncryptedFS;
