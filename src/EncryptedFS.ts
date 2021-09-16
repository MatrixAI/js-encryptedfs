import type {
  Navigated,
  ParsedPath,
  Callback,
  Path,
  Options,
  Data,
  File,
} from './types';
import type { INodeIndex } from './inodes/types';
import type { FdIndex } from './fd/types';
import type { OptionsStream } from './streams/types';

import pathNode from 'path';
import Logger from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from './db';
import { INodeManager } from './inodes';
import CurrentDirectory from './CurrentDirectory';
import { FileDescriptor, FileDescriptorManager } from './fd';
import { ReadStream, WriteStream } from './streams';
import { EncryptedFSError, errno } from '.';
import { maybeCallback } from './utils';

import * as inodesErrors from './inodes/errors';

/**
 * Prefer the posix join function if it exists.
 * Browser polyfills of the path module may not have the posix property.
 */
const pathJoin = pathNode.posix ? pathNode.posix.join : pathNode.join;

class EncryptedFS {
  protected db: DB;
  protected devMgr: vfs.DeviceManager;
  protected _iNodeMgr: INodeManager;
  protected _fdMgr: FileDescriptorManager;
  protected _root: INodeIndex;
  protected _cwd: CurrentDirectory;
  protected _uid: number;
  protected _gid: number;
  protected _umask: number;
  protected _blkSize: number;
  protected logger: Logger;

  public static async createEncryptedFS({
    dbKey,
    dbPath,
    db,
    devMgr,
    iNodeMgr,
    blkSize = 4096,
    umask = 0o022,
    logger = new Logger(EncryptedFS.name),
  }: {
    dbKey: Buffer;
    dbPath: string;
    db?: DB;
    devMgr?: vfs.DeviceManager;
    iNodeMgr?: INodeManager;
    blkSize?: number;
    umask?: number;
    logger?: Logger;
  }) {
    db =
      db ??
      (await DB.createDB({
        dbKey,
        dbPath,
        logger: logger.getChild(DB.name),
      }));
    devMgr = devMgr ?? new vfs.DeviceManager();
    iNodeMgr =
      iNodeMgr ??
      (await INodeManager.createINodeManager({
        db,
        devMgr,
        logger: logger.getChild(INodeManager.name),
      }));
    const iNodeManager = iNodeMgr;
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeManager.transact(
      async (tran) => {
        tran.queueFailure(() => {
          if (!iNodeManager) throw Error;
          iNodeManager.inoDeallocate(rootIno);
        });
        await iNodeManager.dirCreate(tran, rootIno, {
          mode: vfs.DEFAULT_ROOT_PERM,
          uid: vfs.DEFAULT_ROOT_UID,
          gid: vfs.DEFAULT_ROOT_GID,
        });
      },
      [rootIno],
    );
    const efs = new EncryptedFS({
      db,
      devMgr,
      iNodeMgr,
      rootIno,
      blkSize,
      umask,
      logger,
    });
    await efs.start();

    return efs;
  }

  // Synchronous constructor for the instance
  protected constructor({
    db,
    devMgr,
    iNodeMgr,
    rootIno,
    blkSize,
    umask,
    logger,
  }: {
    db: DB;
    devMgr: vfs.DeviceManager;
    iNodeMgr: INodeManager;
    rootIno: INodeIndex;
    blkSize: number;
    umask: number;
    logger: Logger;
  }) {
    this.db = db;
    this.devMgr = devMgr;
    this._iNodeMgr = iNodeMgr;
    this._fdMgr = new FileDescriptorManager(this._iNodeMgr);
    this._root = rootIno;
    this._cwd = new CurrentDirectory(this._iNodeMgr, this._root);
    this._uid = vfs.DEFAULT_ROOT_UID;
    this._gid = vfs.DEFAULT_ROOT_GID;
    this._umask = umask;
    this._blkSize = blkSize;
    this.logger = logger;
  }

  get promises() {
    return this;
  }

  get cwd() {
    return this._cwd.path;
  }

  set uid(uid: number) {
    this._uid = uid;
  }

  get uid() {
    return this._uid;
  }

  set gid(gid: number) {
    this._gid = gid;
  }

  get gid() {
    return this._gid;
  }

  public async start() {
    // Start it up again
    // requires decryption keys
    // only after you stop it
    // create the initial root inode
    // well wait a minute
    // that's not exactly necessary
    await this.db.start();
  }

  public async stop() {
    // Shutdown the EFS instance
    await this.db.stop();
  }

  public async destroy() {
    // Wipe out the entire FS
    await this.db.destroy();
  }

  public async chdir(path: string): Promise<void> {
    path = this.getPath(path);
    const navigated = await this.navigate(path, true);
    if (!navigated.target) {
      throw new EncryptedFSError(errno.ENOENT, path);
    }
    const target = navigated.target;
    await this._iNodeMgr.transact(
      async (tran) => {
        const targetType = (await this._iNodeMgr.get(tran, target))?.type;
        const targetStat = await this._iNodeMgr.statGet(tran, target);
        if (!(targetType === 'Directory')) {
          throw new EncryptedFSError(errno.ENOTDIR, path);
        }
        if (!this.checkPermissions(vfs.constants.X_OK, targetStat)) {
          throw new EncryptedFSError(errno.EACCES, path);
        }
        await this._cwd.changeDir(target, navigated.pathStack);
      },
      [target],
    );
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
    modeOrCallback: number | Callback = vfs.constants.F_OK,
    callback?: Callback,
  ): Promise<void> {
    const mode =
      typeof modeOrCallback !== 'function'
        ? modeOrCallback
        : vfs.constants.F_OK;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (!target) {
        throw new EncryptedFSError(
          errno.ENOENT,
          `access ${path} does not exist`,
        );
      }
      if (mode === vfs.constants.F_OK) {
        return;
      }
      let targetStat;
      await this._iNodeMgr.transact(async (tran) => {
        targetStat = await this._iNodeMgr.statGet(tran, target);
      });
      if (!this.checkPermissions(mode, targetStat)) {
        throw new EncryptedFSError(
          errno.EACCES,
          `access ${path} does not exist`,
        );
      }
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
      mode: vfs.DEFAULT_FILE_PERM,
      flag: 'a',
    },
    callback?: Callback,
  ): Promise<void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? this.getOptions(
            { encoding: 'utf8' as BufferEncoding, mode: vfs.DEFAULT_FILE_PERM },
            optionsOrCallback,
          )
        : ({ encoding: 'utf8', mode: vfs.DEFAULT_FILE_PERM } as Options);
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return maybeCallback(async () => {
      options.flag = 'a';
      data = this.getBuffer(data, options.encoding);
      let fdIndex;
      try {
        let fd;
        if (typeof file === 'number') {
          fd = this._fdMgr.getFd(file);
          if (!fd)
            throw new EncryptedFSError(
              errno.EBADF,
              `appendFile '${fd}' invalid File Descriptor`,
            );
          if (!(fd.flags & (vfs.constants.O_WRONLY | vfs.constants.O_RDWR))) {
            throw new EncryptedFSError(
              errno.EBADF,
              `appendFile '${fd}' invalide File Descriptor flags`,
            );
          }
        } else {
          [fd, fdIndex] = await this._open(
            file as Path,
            options.flag,
            options.mode,
          );
        }
        try {
          await fd.write(data, undefined, vfs.constants.O_APPEND);
        } catch (e) {
          if (e instanceof RangeError) {
            throw new EncryptedFSError(errno.EFBIG, 'appendFile');
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
    return maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (!target) {
        throw new EncryptedFSError(errno.ENOENT, `chmod '${path}'`);
      }
      if (typeof mode !== 'number') {
        throw new TypeError('mode must be an integer');
      }
      await this._iNodeMgr.transact(
        async (tran) => {
          const targetStat = await this._iNodeMgr.statGet(tran, target);
          if (
            this._uid !== vfs.DEFAULT_ROOT_UID &&
            this._uid !== targetStat.uid
          ) {
            throw new EncryptedFSError(errno.EPERM, `chmod '${path}'`);
          }
          await this._iNodeMgr.statSetProp(
            tran,
            target,
            'mode',
            (targetStat.mode & vfs.constants.S_IFMT) | mode,
          );
        },
        [target],
      );
    }, callback);
  }

  public async chown(
    path: Path,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (!target) {
        throw new EncryptedFSError(errno.ENOENT, `chown '${path}'`);
      }
      await this._iNodeMgr.transact(
        async (tran) => {
          const targetStat = await this._iNodeMgr.statGet(tran, target);
          if (this._uid !== vfs.DEFAULT_ROOT_UID) {
            // You don't own the file
            if (targetStat.uid !== this._uid) {
              throw new EncryptedFSError(errno.EPERM, `chown '${path}'`);
            }
            // You cannot give files to others
            if (this._uid !== uid) {
              throw new EncryptedFSError(errno.EPERM, `chown '${path}'`);
            }
            // Because we don't have user group hierarchies, we allow chowning to any group
          }
          await this._iNodeMgr.statSetProp(tran, target, 'uid', uid);
          await this._iNodeMgr.statSetProp(tran, target, 'gid', gid);
        },
        [target],
      );
    }, callback);
  }

  public async chownr(
    path: Path,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return maybeCallback(async () => {
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
        const pathChild = pathJoin(path as string, child);
        // Don't traverse symlinks
        if (!((await this.lstat(pathChild)) as vfs.Stat).isSymbolicLink()) {
          await this.chownr(pathChild, uid, gid);
        }
      }
    }, callback);
  }

  public async close(fdIndex: FdIndex, callback?: Callback): Promise<void> {
    return maybeCallback(async () => {
      if (!this._fdMgr.getFd(fdIndex)) {
        throw new EncryptedFSError(errno.EBADF, `close '${fdIndex}'`);
      }
      await this._fdMgr.deleteFd(fdIndex);
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
    return maybeCallback(async () => {
      srcPath = this.getPath(srcPath);
      dstPath = this.getPath(dstPath);
      let srcFd, srcFdIndex, dstFd, dstFdIndex;
      try {
        // The only things that are copied is the data and the mode
        [srcFd, srcFdIndex] = await this._open(srcPath, vfs.constants.O_RDONLY);
        const srcINode = srcFd.ino;
        await this._iNodeMgr.transact(async (tran) => {
          tran.queueFailure(() => {
            this._iNodeMgr.inoDeallocate(dstINode);
          });
          const srcINodeType = (await this._iNodeMgr.get(tran, srcINode))?.type;
          const srcINodeStat = await this._iNodeMgr.statGet(tran, srcINode);
          if (srcINodeType === 'Directory') {
            throw new EncryptedFSError(
              errno.EBADF,
              `copyFile '${srcPath}', '${dstPath}'`,
            );
          }
          let dstFlags = vfs.constants.O_WRONLY | vfs.constants.O_CREAT;
          if (flags & vfs.constants.COPYFILE_EXCL) {
            dstFlags |= vfs.constants.O_EXCL;
          }
          [dstFd, dstFdIndex] = await this._open(
            dstPath,
            dstFlags,
            srcINodeStat.mode,
          );
          const dstINode = dstFd.ino;
          const dstINodeType = (await this._iNodeMgr.get(tran, dstINode))?.type;
          if (dstINodeType === 'File') {
            let blkCounter = 0;
            for await (const block of this._iNodeMgr.fileGetBlocks(
              tran,
              srcINode,
              this._blkSize,
            )) {
              await this._iNodeMgr.fileSetBlocks(
                tran,
                dstFd.ino,
                block,
                this._blkSize,
                blkCounter,
              );
              blkCounter++;
            }
          } else {
            throw new EncryptedFSError(
              errno.EINVAL,
              `copyFile '${srcPath}', '${dstPath}'`,
            );
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
      mode: vfs.DEFAULT_FILE_PERM,
      autoClose: true,
      end: Infinity,
    };
    const options =
      typeof optionsOrCallback !== 'function'
        ? (this.getOptions(defaultOps, optionsOrCallback) as OptionsStream)
        : defaultOps;
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return maybeCallback(async () => {
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
      mode: vfs.DEFAULT_FILE_PERM,
      autoClose: true,
    };
    const options =
      typeof optionsOrCallback !== 'function'
        ? (this.getOptions(defaultOps, optionsOrCallback) as OptionsStream)
        : defaultOps;
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return maybeCallback(async () => {
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
    return maybeCallback(async () => {
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
    return maybeCallback(async () => {
      if (offset < 0 || len <= 0) {
        throw new EncryptedFSError(errno.EINVAL, `fallocate '${fdIndex}'`);
      }
      const fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new EncryptedFSError(errno.EBADF, `fallocate '${fdIndex}'`);
      }
      const iNode = fd.ino;
      await this._iNodeMgr.transact(
        async (tran) => {
          const iNodeType = (await this._iNodeMgr.get(tran, iNode))?.type;
          if (!(iNodeType === 'File')) {
            throw new EncryptedFSError(errno.ENODEV, `fallocate '${fdIndex}'`);
          }
          if (!(fd.flags & (vfs.constants.O_WRONLY | vfs.constants.O_RDWR))) {
            throw new EncryptedFSError(errno.EBADF, `fallocate '${fdIndex}'`);
          }
          const data = Buffer.alloc(0);
          if (offset + len > data.length) {
            const [index, data] = await this._iNodeMgr.fileGetLastBlock(
              tran,
              iNode,
            );
            let newData;
            try {
              newData = Buffer.concat([
                data,
                Buffer.alloc(offset + len - data.length),
              ]);
            } catch (e) {
              if (e instanceof RangeError) {
                throw new EncryptedFSError(
                  errno.EFBIG,
                  `fallocate '${fdIndex}'`,
                );
              }
              throw e;
            }
            await this._iNodeMgr.fileSetBlocks(
              tran,
              iNode,
              newData,
              this._blkSize,
              index,
            );
            await this._iNodeMgr.statSetProp(
              tran,
              iNode,
              'size',
              newData.length,
            );
          }
          await this._iNodeMgr.statSetProp(tran, iNode, 'ctime', new Date());
        },
        [iNode],
      );
    }, callback);
  }

  public async fchmod(
    fdIndex: FdIndex,
    mode: number,
    callback?: Callback,
  ): Promise<void> {
    return maybeCallback(async () => {
      const fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new EncryptedFSError(errno.EBADF, `fchmod '${fdIndex}'`);
      }
      if (typeof mode !== 'number') {
        throw new TypeError('mode must be an integer');
      }
      await this._iNodeMgr.transact(
        async (tran) => {
          const fdStat = await this._iNodeMgr.statGet(tran, fd.ino);
          if (this._uid !== vfs.DEFAULT_ROOT_UID && this._uid !== fdStat.uid) {
            throw new EncryptedFSError(errno.EPERM, `fchmod '${fdIndex}'`);
          }
          await this._iNodeMgr.statSetProp(
            tran,
            fd.ino,
            'mode',
            (fdStat.mode & vfs.constants.S_IFMT) | mode,
          );
        },
        [fd.ino],
      );
    }, callback);
  }

  public async fchown(
    fdIndex: FdIndex,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return maybeCallback(async () => {
      const fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new EncryptedFSError(errno.EBADF, `fchown '${fdIndex}'`);
      }
      await this._iNodeMgr.transact(
        async (tran) => {
          const fdStat = await this._iNodeMgr.statGet(tran, fd.ino);
          if (this._uid !== vfs.DEFAULT_ROOT_UID) {
            // You don't own the file
            if (fdStat.uid !== this._uid) {
              throw new EncryptedFSError(errno.EPERM, `fchown '${fdIndex}'`);
            }
            // You cannot give files to others
            if (this._uid !== uid) {
              throw new EncryptedFSError(errno.EPERM, `fchown '${fdIndex}'`);
            }
            // Because we don't have user group hierarchies, we allow chowning to any group
          }
          await this._iNodeMgr.statSetProp(tran, fd.ino, 'uid', uid);
          await this._iNodeMgr.statSetProp(tran, fd.ino, 'gid', gid);
        },
        [fd.ino],
      );
    }, callback);
  }

  public async fdatasync(fdIndex: FdIndex, callback?: Callback): Promise<void> {
    return maybeCallback(async () => {
      if (!this._fdMgr.getFd(fdIndex)) {
        throw new EncryptedFSError(errno.EBADF, `fdatasync '${fdIndex}`);
      }
    }, callback);
  }

  public async fstat(fdIndex: FdIndex): Promise<vfs.Stat>;
  public async fstat(
    fdIndex: FdIndex,
    callback: Callback<[vfs.Stat]>,
  ): Promise<void>;
  public async fstat(
    fdIndex: FdIndex,
    callback?: Callback<[vfs.Stat]>,
  ): Promise<vfs.Stat | void> {
    return maybeCallback(async () => {
      const fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new EncryptedFSError(errno.EBADF, `fstat '${fdIndex}'`);
      }
      let fdStat;
      await this._iNodeMgr.transact(
        async (tran) => {
          fdStat = await this._iNodeMgr.statGet(tran, fd.ino);
        },
        [fd.ino],
      );
      return new vfs.Stat(fdStat);
    }, callback);
  }

  public async fsync(fdIndex: FdIndex, callback?: Callback): Promise<void> {
    return maybeCallback(async () => {
      if (!this._fdMgr.getFd(fdIndex)) {
        throw new EncryptedFSError(errno.EBADF, `fsync '${fdIndex}'`);
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
    return maybeCallback(async () => {
      if (len < 0) {
        throw new EncryptedFSError(errno.EINVAL, `ftruncate '${fdIndex}'`);
      }
      const fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new EncryptedFSError(errno.EBADF, `ftruncate '${fdIndex}'`);
      }
      const iNode = fd.ino;
      let newData;
      await this._iNodeMgr.transact(
        async (tran) => {
          const iNodeType = (await this._iNodeMgr.get(tran, iNode))?.type;
          if (!(iNodeType === 'File')) {
            throw new EncryptedFSError(errno.EINVAL, `ftruncate '${fdIndex}'`);
          }
          if (!(fd.flags & (vfs.constants.O_WRONLY | vfs.constants.O_RDWR))) {
            throw new EncryptedFSError(errno.EINVAL, `ftruncate '${fdIndex}'`);
          }
          let data = Buffer.alloc(0);
          for await (const block of this._iNodeMgr.fileGetBlocks(
            tran,
            iNode,
            this._blkSize,
          )) {
            data = Buffer.concat([data, block]);
          }
          try {
            if (len > data.length) {
              newData = Buffer.alloc(len);
              data.copy(newData, 0, 0, data.length);
              await this._iNodeMgr.fileSetBlocks(
                tran,
                iNode,
                newData,
                this._blkSize,
              );
            } else if (len < data.length) {
              newData = Buffer.allocUnsafe(len);
              data.copy(newData, 0, 0, len);
              await this._iNodeMgr.fileClearData(tran, iNode);
              await this._iNodeMgr.fileSetBlocks(
                tran,
                iNode,
                newData,
                this._blkSize,
              );
            } else {
              newData = data;
            }
          } catch (e) {
            if (e instanceof RangeError) {
              throw new EncryptedFSError(errno.EFBIG, `ftruncate '${fdIndex}'`);
            }
            throw e;
          }
          const now = new Date();
          await this._iNodeMgr.statSetProp(tran, iNode, 'mtime', now);
          await this._iNodeMgr.statSetProp(tran, iNode, 'ctime', now);
          await this._iNodeMgr.statSetProp(tran, iNode, 'size', newData.length);
        },
        [iNode],
      );
      await fd.setPos(Math.min(newData.length, fd.pos));
    }, callback);
  }

  public async futimes(
    fdIndex: FdIndex,
    atime: number | string | Date,
    mtime: number | string | Date,
    callback?: Callback,
  ): Promise<void> {
    return maybeCallback(async () => {
      const fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new EncryptedFSError(errno.EBADF, `futimes '${fdIndex}`);
      }
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
      await this._iNodeMgr.transact(async (tran) => {
        await this._iNodeMgr.statSetProp(tran, fd.ino, 'atime', newAtime);
        await this._iNodeMgr.statSetProp(tran, fd.ino, 'mtime', newMtime);
        await this._iNodeMgr.statSetProp(tran, fd.ino, 'ctime', new Date());
      });
    }, callback);
  }

  public async lchmod(
    path: Path,
    mode: number,
    callback?: Callback,
  ): Promise<void> {
    return maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      if (!target) {
        throw new EncryptedFSError(errno.ENOENT, `lchmod '${path}'`);
      }
      if (typeof mode !== 'number') {
        throw new TypeError('mode must be an integer');
      }
      await this._iNodeMgr.transact(
        async (tran) => {
          const targetStat = await this._iNodeMgr.statGet(tran, target);
          if (
            this._uid !== vfs.DEFAULT_ROOT_UID &&
            this._uid !== targetStat.uid
          ) {
            throw new EncryptedFSError(errno.EPERM, `lchmod '${path}'`);
          }
          await this._iNodeMgr.statSetProp(
            tran,
            target,
            'mode',
            (targetStat.mode & vfs.constants.S_IFMT) | mode,
          );
        },
        [target],
      );
    }, callback);
  }

  public async lchown(
    path: Path,
    uid: number,
    gid: number,
    callback?: Callback,
  ): Promise<void> {
    return maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      if (!target) {
        throw new EncryptedFSError(errno.ENOENT, `lchown '${path}'`);
      }
      await this._iNodeMgr.transact(
        async (tran) => {
          const targetStat = await this._iNodeMgr.statGet(tran, target);
          if (this._uid !== vfs.DEFAULT_ROOT_UID) {
            // You don't own the file
            if (targetStat.uid !== this._uid) {
              throw new EncryptedFSError(errno.EPERM, `lchown '${path}'`);
            }
            // You cannot give files to others
            if (this._uid !== uid) {
              throw new EncryptedFSError(errno.EPERM, `lchown '${path}'`);
            }
            // Because we don't have user group hierarchies, we allow chowning to any group
          }
          await this._iNodeMgr.statSetProp(tran, target, 'uid', uid);
          await this._iNodeMgr.statSetProp(tran, target, 'gid', gid);
        },
        [target],
      );
    }, callback);
  }

  public async link(
    existingPath: Path,
    newPath: Path,
    callback?: Callback,
  ): Promise<void> {
    return maybeCallback(async () => {
      existingPath = this.getPath(existingPath);
      newPath = this.getPath(newPath);
      const navigatedExisting = await this.navigate(existingPath, false);
      const navigatedNew = await this.navigate(newPath, false);
      if (!navigatedExisting.target) {
        throw new EncryptedFSError(
          errno.ENOENT,
          `link '${existingPath}', '${newPath}'`,
        );
      }
      const existingTarget = navigatedExisting.target;
      await this._iNodeMgr.transact(
        async (tran) => {
          const existingTargetType = (
            await this._iNodeMgr.get(tran, existingTarget)
          )?.type;
          if (existingTargetType === 'Directory') {
            throw new EncryptedFSError(
              errno.EPERM,
              `link '${existingPath}', '${newPath}'`,
            );
          }
          if (!navigatedNew.target) {
            const newDirStat = await this._iNodeMgr.statGet(
              tran,
              navigatedNew.dir,
            );
            if (newDirStat.nlink < 2) {
              throw new EncryptedFSError(
                errno.ENOENT,
                `link '${existingPath}', '${newPath}'`,
              );
            }
            if (!this.checkPermissions(vfs.constants.W_OK, newDirStat)) {
              throw new EncryptedFSError(
                errno.EACCES,
                `link '${existingPath}', '${newPath}'`,
              );
            }
            const index = await this._iNodeMgr.dirGetEntry(
              tran,
              navigatedExisting.dir,
              navigatedExisting.name,
            );
            await this._iNodeMgr.dirSetEntry(
              tran,
              navigatedNew.dir,
              navigatedNew.name,
              index as INodeIndex,
            );
            await this._iNodeMgr.statSetProp(
              tran,
              existingTarget,
              'ctime',
              new Date(),
            );
          } else {
            throw new EncryptedFSError(
              errno.EEXIST,
              `link '${existingPath}', '${newPath}'`,
            );
          }
        },
        [navigatedExisting.target, navigatedNew.dir],
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
    seekFlagsOrCallback: number | Callback<[number]> = vfs.constants.SEEK_SET,
    callback?: Callback<[number]>,
  ): Promise<number | void> {
    const seekFlags =
      typeof seekFlagsOrCallback !== 'function'
        ? seekFlagsOrCallback
        : vfs.constants.SEEK_SET;
    callback =
      typeof seekFlagsOrCallback === 'function'
        ? seekFlagsOrCallback
        : callback;
    return maybeCallback(async () => {
      const fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new EncryptedFSError(errno.EBADF, `lseek '${fdIndex}'`);
      }
      if (
        [
          vfs.constants.SEEK_SET,
          vfs.constants.SEEK_CUR,
          vfs.constants.SEEK_END,
        ].indexOf(seekFlags) === -1
      ) {
        throw new EncryptedFSError(errno.EINVAL, `lseek '${fdIndex}'`);
      }
      await fd.setPos(position, seekFlags);
      return fd.pos;
    }, callback);
  }

  public async lstat(path: Path): Promise<vfs.Stat>;
  public async lstat(path: Path, callback: Callback<[vfs.Stat]>): Promise<void>;
  public async lstat(
    path: Path,
    callback?: Callback<[vfs.Stat]>,
  ): Promise<vfs.Stat | void> {
    return maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      if (target) {
        let targetStat;
        await this._iNodeMgr.transact(
          async (tran) => {
            targetStat = await this._iNodeMgr.statGet(tran, target);
          },
          [target],
        );
        return new vfs.Stat({ ...targetStat });
      } else {
        throw new EncryptedFSError(errno.ENOENT, `lstat '${path}'`);
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
    modeOrCallback: number | Callback = vfs.DEFAULT_DIRECTORY_PERM,
    callback?: Callback,
  ): Promise<void> {
    const mode =
      typeof modeOrCallback !== 'function'
        ? modeOrCallback
        : vfs.DEFAULT_DIRECTORY_PERM;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return maybeCallback(async () => {
      path = this.getPath(path);
      // We expect a non-existent directory
      path = path.replace(/(.+?)\/+$/, '$1');
      const navigated = await this.navigate(path, true);
      if (navigated.target) {
        throw new EncryptedFSError(
          errno.EEXIST,
          `mkdir '${path}' already exists`,
        );
      } else if (!navigated.target && navigated.remaining) {
        throw new EncryptedFSError(
          errno.ENOENT,
          `mkdir '${path}' does not exist`,
        );
      } else if (!navigated.target) {
        let navigatedDirStats;
        const dirINode = this._iNodeMgr.inoAllocate();
        await this._iNodeMgr.transact(
          async (tran) => {
            tran.queueFailure(() => {
              this._iNodeMgr.inoDeallocate(dirINode);
            });
            navigatedDirStats = await this._iNodeMgr.statGet(
              tran,
              navigated.dir,
            );
            if (navigatedDirStats['nlink'] < 2) {
              throw new EncryptedFSError(
                errno.ENOENT,
                `mkdir '${path}' does not exist`,
              );
            }
            if (!this.checkPermissions(vfs.constants.W_OK, navigatedDirStats)) {
              throw new EncryptedFSError(
                errno.EACCES,
                `mkdir '${path}' does not have correct permissions`,
              );
            }
            await this._iNodeMgr.dirCreate(
              tran,
              dirINode,
              {
                mode: vfs.applyUmask(mode, this._umask),
                uid: this._uid,
                gid: this._gid,
              },
              await this._iNodeMgr.dirGetEntry(tran, navigated.dir, '.'),
            );
            await this._iNodeMgr.dirSetEntry(
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
    modeOrCallback: number | Callback = vfs.DEFAULT_DIRECTORY_PERM,
    callback?: Callback,
  ): Promise<void> {
    const mode =
      typeof modeOrCallback !== 'function'
        ? modeOrCallback
        : vfs.DEFAULT_DIRECTORY_PERM;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return maybeCallback(async () => {
      path = this.getPath(path);
      // We expect a directory
      path = path.replace(/(.+?)\/+$/, '$1');
      let currentDir, navigatedTargetType;
      let navigated = await this.navigate(path, true);
      for (;;) {
        if (!navigated.target) {
          let navigatedDirStat;
          const dirINode = this._iNodeMgr.inoAllocate();
          await this._iNodeMgr.transact(
            async (tran) => {
              tran.queueFailure(() => {
                this._iNodeMgr.inoDeallocate(dirINode);
              });
              navigatedDirStat = await this._iNodeMgr.statGet(
                tran,
                navigated.dir,
              );
              if (navigatedDirStat.nlink < 2) {
                throw new EncryptedFSError(
                  errno.ENOENT,
                  `mkdirp '${path}' does not exist`,
                );
              }
              if (
                !this.checkPermissions(vfs.constants.W_OK, navigatedDirStat)
              ) {
                throw new EncryptedFSError(
                  errno.EACCES,
                  `mkdirp '${path}' does not have correct permissions`,
                );
              }
              await this._iNodeMgr.dirCreate(
                tran,
                dirINode,
                {
                  mode: vfs.applyUmask(mode, this._umask),
                  uid: this._uid,
                  gid: this._gid,
                },
                await this._iNodeMgr.dirGetEntry(tran, navigated.dir, '.'),
              );
              await this._iNodeMgr.dirSetEntry(
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
          await this._iNodeMgr.transact(
            async (tran) => {
              navigatedTargetType = (
                await this._iNodeMgr.get(tran, navigatedTarget)
              )?.type;
            },
            [navigated.target],
          );
          if (navigatedTargetType !== 'Directory') {
            throw new EncryptedFSError(
              errno.ENOTDIR,
              `mkdirp '${path}' is not a directory`,
            );
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
    return maybeCallback(async () => {
      if (!pathSPrefix || typeof pathSPrefix !== 'string') {
        throw new TypeError('filename prefix is required');
      }
      const getChar = () => {
        const possibleChars =
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return possibleChars[Math.floor(Math.random() * possibleChars.length)];
      };
      let pathS;
      for (;;) {
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
    modeOrCallback: number | Callback = vfs.DEFAULT_FILE_PERM,
    callback?: Callback,
  ): Promise<void> {
    const mode =
      typeof modeOrCallback !== 'function'
        ? modeOrCallback
        : vfs.DEFAULT_FILE_PERM;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return maybeCallback(async () => {
      path = this.getPath(path);
      const navigated = await this.navigate(path, false);
      if (navigated.target) {
        throw new EncryptedFSError(errno.EEXIST, `mknod '${path}'`);
      }
      const iNode = this._iNodeMgr.inoAllocate();
      await this._iNodeMgr.transact(
        async (tran) => {
          tran.queueFailure(() => {
            this._iNodeMgr.inoDeallocate(iNode);
          });
          const navigatedDirStat = await this._iNodeMgr.statGet(
            tran,
            navigated.dir,
          );
          if (navigatedDirStat.nlink < 2) {
            throw new EncryptedFSError(errno.ENOENT, `mknod '${path}'`);
          }
          if (!this.checkPermissions(vfs.constants.W_OK, navigatedDirStat)) {
            throw new EncryptedFSError(errno.EACCES, `mknod '${path}'`);
          }
          switch (type) {
            case vfs.constants.S_IFREG:
              await this._iNodeMgr.fileCreate(
                tran,
                iNode,
                {
                  mode: vfs.applyUmask(mode, this._umask),
                  uid: this._uid,
                  gid: this._gid,
                },
                this._blkSize,
              );
              break;
            case vfs.constants.S_IFCHR:
              if (typeof major !== 'number' || typeof minor !== 'number') {
                throw TypeError(
                  'major and minor must set as numbers when creating device nodes',
                );
              }
              if (
                major > vfs.MAJOR_MAX ||
                minor > vfs.MINOR_MAX ||
                minor < vfs.MAJOR_MIN ||
                minor < vfs.MINOR_MIN
              ) {
                throw new EncryptedFSError(errno.EINVAL, `mknod '${path}'`);
              }
              await this._iNodeMgr.charDevCreate(tran, iNode, {
                mode: vfs.applyUmask(mode, this._umask),
                uid: this._uid,
                gid: this._gid,
                rdev: vfs.mkDev(major, minor),
              });
              break;
            default:
              throw new EncryptedFSError(errno.EPERM, `mknod '${path}'`);
          }
          await this._iNodeMgr.dirSetEntry(
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
    modeOrCallback: number | Callback<[FdIndex]> = vfs.DEFAULT_FILE_PERM,
    callback?: Callback<[FdIndex]>,
  ): Promise<FdIndex | void> {
    const mode =
      typeof modeOrCallback !== 'function'
        ? modeOrCallback
        : vfs.DEFAULT_FILE_PERM;
    callback = typeof modeOrCallback === 'function' ? modeOrCallback : callback;
    return maybeCallback(async () => {
      return (await this._open(path, flags, mode))[1];
    }, callback);
  }

  protected async _open(
    path: Path,
    flags: string | number,
    mode: number = vfs.DEFAULT_FILE_PERM,
  ): Promise<[FileDescriptor, FdIndex]> {
    path = this.getPath(path);
    if (typeof flags === 'string') {
      switch (flags) {
        case 'r':
        case 'rs':
          flags = vfs.constants.O_RDONLY;
          break;
        case 'r+':
        case 'rs+':
          flags = vfs.constants.O_RDWR;
          break;
        case 'w':
          flags =
            vfs.constants.O_WRONLY |
            vfs.constants.O_CREAT |
            vfs.constants.O_TRUNC;
          break;
        case 'wx':
          flags =
            vfs.constants.O_WRONLY |
            vfs.constants.O_CREAT |
            vfs.constants.O_TRUNC |
            vfs.constants.O_EXCL;
          break;
        case 'w+':
          flags =
            vfs.constants.O_RDWR |
            vfs.constants.O_CREAT |
            vfs.constants.O_TRUNC;
          break;
        case 'wx+':
          flags =
            vfs.constants.O_RDWR |
            vfs.constants.O_CREAT |
            vfs.constants.O_TRUNC |
            vfs.constants.O_EXCL;
          break;
        case 'a':
          flags =
            vfs.constants.O_WRONLY |
            vfs.constants.O_APPEND |
            vfs.constants.O_CREAT;
          break;
        case 'ax':
          flags =
            vfs.constants.O_WRONLY |
            vfs.constants.O_APPEND |
            vfs.constants.O_CREAT |
            vfs.constants.O_EXCL;
          break;
        case 'a+':
          flags =
            vfs.constants.O_RDWR |
            vfs.constants.O_APPEND |
            vfs.constants.O_CREAT;
          break;
        case 'ax+':
          flags =
            vfs.constants.O_RDWR |
            vfs.constants.O_APPEND |
            vfs.constants.O_CREAT |
            vfs.constants.O_EXCL;
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
    await this._iNodeMgr.transact(
      async (tran) => {
        for (;;) {
          if (!target) {
            // O_CREAT only applies if there's a left over name without any remaining path
            if (!navigated.remaining && openFlags & vfs.constants.O_CREAT) {
              let navigatedDirStat;
              const fileINode = this._iNodeMgr.inoAllocate();
              await this._iNodeMgr.transact(
                async (tran) => {
                  tran.queueFailure(() => {
                    this._iNodeMgr.inoDeallocate(fileINode);
                  });
                  navigatedDirStat = await this._iNodeMgr.statGet(
                    tran,
                    navigated.dir,
                  );
                  // Cannot create if the current directory has been unlinked from its parent directory
                  if (navigatedDirStat.nlink < 2) {
                    throw new EncryptedFSError(errno.ENOENT, `open '${path}'`);
                  }
                  if (
                    !this.checkPermissions(vfs.constants.W_OK, navigatedDirStat)
                  ) {
                    throw new EncryptedFSError(errno.EACCES, `open '${path}'`);
                  }
                  await this._iNodeMgr.fileCreate(
                    tran,
                    fileINode,
                    {
                      mode: vfs.applyUmask(mode, this._umask),
                      uid: this._uid,
                      gid: this._gid,
                    },
                    this._blkSize,
                  );
                  await this._iNodeMgr.dirSetEntry(
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
              throw new EncryptedFSError(errno.ENOENT, `open '${path}'`);
            }
          } else {
            const targetType = (await this._iNodeMgr.get(tran, target))?.type;
            if (targetType === 'Symlink') {
              // Cannot be symlink if O_NOFOLLOW
              if (openFlags & vfs.constants.O_NOFOLLOW) {
                throw new EncryptedFSError(errno.ELOOP, `open '${path}'`);
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
                openFlags & vfs.constants.O_CREAT &&
                openFlags & vfs.constants.O_EXCL
              ) {
                throw new EncryptedFSError(errno.EEXIST, `open '${path}'`);
              }
              // Cannot be directory if write capabilities are requested
              if (
                targetType === 'Directory' &&
                openFlags &
                  (vfs.constants.O_WRONLY |
                    (openFlags &
                      (vfs.constants.O_RDWR |
                        (openFlags & vfs.constants.O_TRUNC))))
              ) {
                throw new EncryptedFSError(errno.EISDIR, `open '${path}'`);
              }
              // Must be directory if O_DIRECTORY
              if (
                openFlags & vfs.constants.O_DIRECTORY &&
                !(targetType === 'Directory')
              ) {
                throw new EncryptedFSError(errno.ENOTDIR, `open '${path}'`);
              }
              // Must truncate a file if O_TRUNC
              if (
                openFlags & vfs.constants.O_TRUNC &&
                targetType === 'File' &&
                openFlags & (vfs.constants.O_WRONLY | vfs.constants.O_RDWR)
              ) {
                await this._iNodeMgr.fileClearData(tran, target);
                await this._iNodeMgr.fileSetBlocks(
                  tran,
                  target,
                  Buffer.alloc(0),
                  this._blkSize,
                );
              }
              break;
            }
          }
        }
        // Convert file descriptor access flags into bitwise permission flags
        let access;
        if (openFlags & vfs.constants.O_RDWR) {
          access = vfs.constants.R_OK | vfs.constants.W_OK;
        } else if (
          (openFlags & vfs.constants.O_WRONLY) |
          (openFlags & vfs.constants.O_TRUNC)
        ) {
          access = vfs.constants.W_OK;
        } else {
          access = vfs.constants.R_OK;
        }
        const targetStat = await this._iNodeMgr.statGet(tran, target);
        if (!this.checkPermissions(access, targetStat)) {
          throw new EncryptedFSError(errno.EACCES, `open '${path}'`);
        }
        try {
          openRet = await this._fdMgr.createFd(tran, target, openFlags);
        } catch (e) {
          if (e instanceof EncryptedFSError) {
            throw new EncryptedFSError(errno.EACCES, `open '${path}'`);
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
    return maybeCallback(async () => {
      const fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new EncryptedFSError(errno.EBADF, 'read');
      }
      if (typeof position === 'number' && position < 0) {
        throw new EncryptedFSError(errno.EINVAL, 'read');
      }
      let fdStat;
      await this._iNodeMgr.transact(
        async (tran) => {
          fdStat = await this._iNodeMgr.statGet(tran, fd.ino);
        },
        [fd.ino],
      );
      if (fdStat.isDirectory()) {
        throw new EncryptedFSError(errno.EISDIR, 'read');
      }
      const flags = fd.flags;
      if (flags & vfs.constants.O_WRONLY) {
        throw new EncryptedFSError(errno.EBADF, 'read');
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
        if (e instanceof EncryptedFSError) {
          throw new EncryptedFSError(e, 'read');
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
    return maybeCallback(async () => {
      path = this.getPath(path);
      const navigated = await this.navigate(path, true);
      if (!navigated.target) {
        throw new EncryptedFSError(
          errno.ENOENT,
          `readdir '${path}' does not exist`,
        );
      }
      let navigatedTargetType, navigatedTargetStat;
      const target = navigated.target;
      const navigatedTargetEntries: Array<[string | Buffer, INodeIndex]> = [];
      await this._iNodeMgr.transact(
        async (tran) => {
          navigatedTargetType = (await this._iNodeMgr.get(tran, target))?.type;
          navigatedTargetStat = await this._iNodeMgr.statGet(tran, target);
          if (navigatedTargetType !== 'Directory') {
            throw new EncryptedFSError(
              errno.ENOTDIR,
              `readdir '${path}' not a directory`,
            );
          }
          if (!this.checkPermissions(vfs.constants.R_OK, navigatedTargetStat)) {
            throw new EncryptedFSError(
              errno.EACCES,
              `readdir '${path}' does ot have correct permissions`,
            );
          }
          for await (const dirEntry of this._iNodeMgr.dirGet(tran, target)) {
            navigatedTargetEntries.push(dirEntry);
          }
        },
        [navigated.target],
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
    return maybeCallback(async () => {
      options.flag = 'r';
      let fdIndex;
      try {
        const buffer = Buffer.allocUnsafe(this._blkSize);
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
    return maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, false)).target;
      if (!target) {
        throw new EncryptedFSError(errno.ENOENT, `readlink '${path}'`);
      }
      let link;
      await this._iNodeMgr.transact(
        async (tran) => {
          const targetType = (await this._iNodeMgr.get(tran, target))?.type;
          if (!(targetType === 'Symlink')) {
            throw new EncryptedFSError(errno.EINVAL, `readlink '${path}'`);
          }
          link = await this._iNodeMgr.symlinkGetLink(tran, target);
        },
        [target],
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
    return maybeCallback(async () => {
      path = this.getPath(path);
      const navigated = await this.navigate(path, true);
      if (!navigated.target) {
        throw new EncryptedFSError(errno.ENOENT, `realpath '${path}'`);
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
    return maybeCallback(async () => {
      oldPath = this.getPath(oldPath);
      newPath = this.getPath(newPath);
      const navigatedSource = await this.navigate(oldPath, false);
      const navigatedTarget = await this.navigate(newPath, false);
      await this._iNodeMgr.transact(
        async (tran) => {
        if (!navigatedSource.target || navigatedTarget.remaining) {
          throw new EncryptedFSError(
            errno.ENOENT,
            `rename '${oldPath}', ${newPath}'`,
          );
        }
        const sourceTarget = navigatedSource.target;
          const sourceTargetType = (
            await this._iNodeMgr.get(tran, sourceTarget)
          )?.type;
          if (sourceTargetType === 'Directory') {
            // If oldPath is a directory, target must be a directory (if it exists)
            if (navigatedTarget.target) {
              const targetTargetType = (
                await this._iNodeMgr.get(tran, navigatedTarget.target)
              )?.type;
              if (!(targetTargetType === 'Directory')) {
                throw new EncryptedFSError(
                  errno.ENOTDIR,
                  `rename '${oldPath}', ${newPath}'`,
                );
              }
            }
            // Neither oldPath nor newPath can point to root
            if (
              navigatedSource.target === this._root ||
              navigatedTarget.target === this._root
            ) {
              throw new EncryptedFSError(
                errno.EBUSY,
                `rename '${oldPath}', ${newPath}'`,
              );
            }
            // If the target directory contains elements this cannot be done
            // this can be done without read permissions
            if (navigatedTarget.target) {
              const targetEntries: Array<[string, INodeIndex]> = [];
              for await (const entry of this._iNodeMgr.dirGet(
                tran,
                navigatedTarget.target,
              )) {
                targetEntries.push(entry);
              }
              if (targetEntries.length - 2) {
                throw new EncryptedFSError(
                  errno.ENOTEMPTY,
                  `rename '${oldPath}', ${newPath}'`,
                );
              }
            }
            // If any of the paths used .. or ., then `dir` is not the parent directory
            if (
              navigatedSource.name === '.' ||
              navigatedSource.name === '..' ||
              navigatedTarget.name === '.' ||
              navigatedTarget.name === '..'
            ) {
              throw new EncryptedFSError(
                errno.EBUSY,
                `rename '${oldPath}', ${newPath}'`,
              );
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
                throw new EncryptedFSError(
                  errno.EINVAL,
                  `rename '${oldPath}', ${newPath}'`,
                );
              }
            }
          } else {
            // If oldPath is not a directory, then newPath cannot be an existing directory
            if (navigatedTarget.target) {
              const targetTargetType = (
                await this._iNodeMgr.get(tran, navigatedTarget.target)
              )?.type;
              if (targetTargetType === 'Directory') {
                throw new EncryptedFSError(
                  errno.EISDIR,
                  `rename '${oldPath}', ${newPath}'`,
                );
              }
            }
          }
          const sourceDirStat = await this._iNodeMgr.statGet(
            tran,
            navigatedSource.dir,
          );
          const targetDirStat = await this._iNodeMgr.statGet(
            tran,
            navigatedTarget.dir,
          );
          // Both the navigatedSource.dir and navigatedTarget.dir must support write permissions
          if (
            !this.checkPermissions(vfs.constants.W_OK, sourceDirStat) ||
            !this.checkPermissions(vfs.constants.W_OK, targetDirStat)
          ) {
            throw new EncryptedFSError(
              errno.EACCES,
              `rename '${oldPath}', ${newPath}'`,
            );
          }
          // If they are in the same directory, it is simple rename
          if (navigatedSource.dir === navigatedTarget.dir) {
            try {
              await this._iNodeMgr.dirResetEntry(
                tran,
                navigatedSource.dir,
                navigatedSource.name,
                navigatedTarget.name,
              );
              } catch (err) {
                if (err instanceof inodesErrors.ErrorINodesInvalidName) {
                  throw new EncryptedFSError(errno.ENOENT, `rename '${navigatedSource.name}' '${navigatedTarget.name}'`);
                }
                throw err;
              }
            return;
          }
          const index = (await this._iNodeMgr.dirGetEntry(
            tran,
            navigatedSource.dir,
            navigatedSource.name,
          )) as INodeIndex;
          const now = new Date();
          if (navigatedTarget.target) {
            await this._iNodeMgr.statSetProp(
              tran,
              navigatedTarget.target,
              'ctime',
              now,
            );
            await this._iNodeMgr.dirUnsetEntry(
              tran,
              navigatedTarget.dir,
              navigatedTarget.name,
            );
            await this._iNodeMgr.dirSetEntry(
              tran,
              navigatedTarget.dir,
              navigatedTarget.name,
              index,
            );
            await this._iNodeMgr.statSetProp(
              tran,
              navigatedTarget.target,
              'ctime',
              now,
            );
          } else {
            if (targetDirStat.nlink < 2) {
              throw new EncryptedFSError(
                errno.ENOENT,
                `rename '${oldPath}', ${newPath}'`,
              );
            }
            await this._iNodeMgr.dirSetEntry(
              tran,
              navigatedTarget.dir,
              navigatedTarget.name,
              index,
            );
          }
          await this._iNodeMgr.statSetProp(tran, sourceTarget, 'ctime', now);
          await this._iNodeMgr.dirUnsetEntry(
            tran,
            navigatedSource.dir,
            navigatedSource.name,
          );
        },
        navigatedTarget.target
          ? (navigatedSource.target ? [navigatedTarget.target, navigatedSource.target] : [navigatedTarget.target])
          : (navigatedSource.target ? [navigatedSource.target] : []),
      );
    }, callback);
  }

  public async rmdir(path: Path, callback?: Callback): Promise<void> {
    return maybeCallback(async () => {
      path = this.getPath(path);
      // If the path has trailing slashes, navigation would traverse into it
      // we must trim off these trailing slashes to allow these directories to be removed
      path = path.replace(/(.+?)\/+$/, '$1');
      const navigated = await this.navigate(path, false);
      await this._iNodeMgr.transact(
        async (tran) => {
          // This is for if the path resolved to root
          if (!navigated.name) {
            throw new EncryptedFSError(errno.EBUSY, `rmdir '${path}'`);
          }
          // On linux, when .. is used, the parent directory becomes unknown
          // in that case, they return with ENOTEMPTY
          // but the directory may in fact be empty
          // for this edge case, we instead use EINVAL
          if (navigated.name === '.' || navigated.name === '..') {
            throw new EncryptedFSError(errno.EINVAL, `rmdir '${path}'`);
          }
          if (!navigated.target) {
            throw new EncryptedFSError(errno.ENOENT, `rmdir'${path}'`);
          }
          const target = navigated.target;
          const dir = navigated.dir;
          let targetType, dirStat;
          const targetEntries: Array<[string | Buffer, INodeIndex]> = [];
          targetType = (await this._iNodeMgr.get(tran, target))?.type;
          dirStat = await this._iNodeMgr.statGet(tran, dir);
          for await (const entry of this._iNodeMgr.dirGet(tran, target)) {
            targetEntries.push(entry);
          }
          if (!(targetType === 'Directory')) {
            throw new EncryptedFSError(errno.ENOTDIR, `rmdir'${path}'`);
          }
          if (targetEntries.length - 2) {
            throw new EncryptedFSError(errno.ENOTEMPTY, `rmdir'${path}'`);
          }
          if (!this.checkPermissions(vfs.constants.W_OK, dirStat)) {
            throw new EncryptedFSError(errno.EACCES, `rmdir '${path}'`);
          }
          await this._iNodeMgr.dirUnsetEntry(tran, dir, navigated.name);
        },
        navigated.target ? [navigated.target, navigated.dir]: [navigated.dir],
      );
    }, callback);
  }

  public async stat(path: Path): Promise<vfs.Stat>;
  public async stat(path: Path, callback: Callback<[vfs.Stat]>): Promise<void>;
  public async stat(
    path: Path,
    callback?: Callback<[vfs.Stat]>,
  ): Promise<vfs.Stat | void> {
    return maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (target) {
        let targetStat;
        await this._iNodeMgr.transact(
          async (tran) => {
            targetStat = await this._iNodeMgr.statGet(tran, target);
          },
          [target],
        );
        return new vfs.Stat({ ...targetStat });
      } else {
        throw new EncryptedFSError(errno.ENOENT, `stat '${path}`);
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
    // Const type = typeof typeOrCallback !== 'function' ? typeOrCallback : 'file'; // FIXME: remove or not?
    callback = typeof typeOrCallback === 'function' ? typeOrCallback : callback;
    return maybeCallback(async () => {
      dstPath = this.getPath(dstPath);
      srcPath = this.getPath(srcPath);
      if (!dstPath) {
        throw new EncryptedFSError(
          errno.ENOENT,
          `symlink '${srcPath}', '${dstPath}'`,
        );
      }
      const navigated = await this.navigate(srcPath, false);
      if (!navigated.target) {
        const symlinkINode = this._iNodeMgr.inoAllocate();
        await this._iNodeMgr.transact(
          async (tran) => {
            const dirStat = await this._iNodeMgr.statGet(tran, navigated.dir);
            if (dirStat.nlink < 2) {
              throw new EncryptedFSError(
                errno.ENOENT,
                `symlink '${srcPath}', '${dstPath}'`,
              );
            }
            if (!this.checkPermissions(vfs.constants.W_OK, dirStat)) {
              throw new EncryptedFSError(
                errno.EACCES,
                `symlink '${srcPath}', '${dstPath}'`,
              );
            }
            await this._iNodeMgr.symlinkCreate(
              tran,
              symlinkINode,
              {
                mode: vfs.DEFAULT_SYMLINK_PERM,
                uid: this._uid,
                gid: this._gid,
              },
              dstPath as string,
            );
            await this._iNodeMgr.dirSetEntry(
              tran,
              navigated.dir,
              navigated.name,
              symlinkINode,
            );
          },
          [navigated.dir, symlinkINode],
        );
      } else {
        throw new EncryptedFSError(
          errno.EEXIST,
          `symlink '${srcPath}', '${dstPath}'`,
        );
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
    return maybeCallback(async () => {
      if (len < 0) {
        throw new EncryptedFSError(errno.EINVAL, `ftruncate '${file}'`);
      }
      if (typeof file === 'number') {
        await this.ftruncate(file, len);
      } else {
        file = this.getPath(file as Path);
        let fdIndex;
        try {
          fdIndex = await this.open(file, vfs.constants.O_WRONLY);
          await this.ftruncate(fdIndex, len);
        } finally {
          if (fdIndex !== undefined) await this.close(fdIndex);
        }
      }
    }, callback);
  }

  public async unlink(path: Path, callback?: Callback): Promise<void> {
    return maybeCallback(async () => {
      path = this.getPath(path);
      const navigated = await this.navigate(path, false);
      if (!navigated.target) {
        throw new EncryptedFSError(errno.ENOENT, `unlink '${path}'`);
      }
      const target = navigated.target;
      await this._iNodeMgr.transact(
        async (tran) => {
          const dirStat = await this._iNodeMgr.statGet(tran, navigated.dir);
          const targetType = (await this._iNodeMgr.get(tran, target))?.type;
          if (!this.checkPermissions(vfs.constants.W_OK, dirStat)) {
            throw new EncryptedFSError(errno.EACCES, `unlink '${path}'`);
          }
          if (targetType === 'Directory') {
            throw new EncryptedFSError(errno.EISDIR, `unlink '${path}'`);
          }
          const now = new Date();
          await this._iNodeMgr.statSetProp(tran, target, 'ctime', now);
          await this._iNodeMgr.dirUnsetEntry(
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
    return maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (!target) {
        throw new EncryptedFSError(errno.ENOENT, `utimes '${path}'`);
      }
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
      await this._iNodeMgr.transact(
        async (tran) => {
          await this._iNodeMgr.statSetProp(tran, target, 'atime', newAtime);
          await this._iNodeMgr.statSetProp(tran, target, 'mtime', newMtime);
          await this._iNodeMgr.statSetProp(tran, target, 'ctime', new Date());
        },
        [target],
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
    return maybeCallback(async () => {
      const fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new EncryptedFSError(errno.EBADF, 'write');
      }
      if (typeof position === 'number' && position < 0) {
        throw new EncryptedFSError(errno.EINVAL, 'write');
      }
      const flags = fd.flags;
      if (!(flags & (vfs.constants.O_WRONLY | vfs.constants.O_RDWR))) {
        throw new EncryptedFSError(errno.EBADF, 'write');
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
          throw new EncryptedFSError(errno.EFBIG, 'write');
        }
        if (e instanceof EncryptedFSError) {
          throw new EncryptedFSError(e, 'write');
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
      mode: vfs.DEFAULT_FILE_PERM,
      flag: 'w',
    },
    callback?: Callback,
  ): Promise<void> {
    const options =
      typeof optionsOrCallback !== 'function'
        ? this.getOptions(
            { encoding: 'utf8', mode: vfs.DEFAULT_FILE_PERM },
            optionsOrCallback,
          )
        : ({ encoding: 'utf8', mode: vfs.DEFAULT_FILE_PERM } as Options);
    callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    return maybeCallback(async () => {
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
      throw new EncryptedFSError(errno.ENOENT, origPathS);
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
          dir: this._root,
          target: this._root,
          // Root is the only situation where the name is empty
          name: '',
          remaining: '',
          pathStack: [],
        };
      } else {
        return await this.navigateFrom(
          this._root,
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
      throw new EncryptedFSError(errno.ENOENT, origPathS);
    }
    let curdirStat;
    await this._iNodeMgr.transact(
      async (tran) => {
        curdirStat = await this._iNodeMgr.statGet(tran, curdir);
      },
      [curdir],
    );
    if (!this.checkPermissions(vfs.constants.X_OK, curdirStat)) {
      throw new EncryptedFSError(
        errno.EACCES,
        `navigateFrom '${origPathS}' does not have correct permissions`,
      );
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
    await this._iNodeMgr.transact(
      async (tran) => {
        target = await this._iNodeMgr.dirGetEntry(tran, curdir, parse.segment);
      },
      [curdir],
    );
    if (target) {
      await this._iNodeMgr.transact(async (tran) => {
        const targetData = await this._iNodeMgr.get(tran, target);
        targetType = targetData?.type;
      }, []);
      switch (targetType) {
        case 'File':
        case 'CharacterDev': {
          if (!parse.rest) {
            return {
              dir: curdir,
              target: target,
              name: parse.segment,
              remaining: '',
              pathStack: pathStack,
            };
          }
          throw new EncryptedFSError(
            errno.ENOTDIR,
            `navigateFrom '${origPathS}' not a directory`,
          );
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
              throw new EncryptedFSError(
                errno.ELOOP,
                `navigateFrom '${origPathS}' linked to itself`,
              );
            } else {
              activeSymlinks.add(target);
            }
            // Although symlinks should not have an empty links, it's still handled correctly here
            let targetLinks;
            await this._iNodeMgr.transact(async (tran) => {
              targetLinks = await this._iNodeMgr.symlinkGetLink(tran, target);
            }, []);
            nextPath = pathJoin(targetLinks, parse.rest);
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
      throw new EncryptedFSError(undefined, `Could not parse pathS '${pathS}`);
    }
  }

  /**
   * Checks the permissions fixng the current uid and gid.
   * If the user is root, they can access anything.
   */
  protected checkPermissions(access: number, stat: vfs.Stat): boolean {
    if (this._uid !== vfs.DEFAULT_ROOT_UID) {
      return vfs.checkPermissions(access, this._uid, this._gid, stat);
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
