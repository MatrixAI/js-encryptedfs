import type { Navigated, ParsedPath, Callback, path, options, data } from './types';
import type { INodeIndex } from './inodes/types';
import type { FdIndex } from './fd/types';

import pathNode from 'path';
import Logger from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from './db';
import { INodeManager } from './inodes';
import CurrentDirectory from './CurrentDirectory';
import { FileDescriptor, FileDescriptorManager } from './fd';
import { EncryptedFSError, errno } from '.';
import { maybeCallback } from './utils';

/**
 * Prefer the posix join function if it exists.
 * Browser polyfills of the path module may not have the posix property.
 */
 const pathJoin = (pathNode.posix) ? pathNode.posix.join : pathNode.join;

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
  protected logger: Logger;

  public static async createEncryptedFS({
    dbKey,
    dbPath,
    db,
    devMgr,
    iNodeMgr,
    umask = 0o022,
    logger = new Logger(EncryptedFS.name)
  }: {
    dbKey: Buffer;
    dbPath: string;
    db?: DB;
    devMgr?: vfs.DeviceManager;
    iNodeMgr?: INodeManager;
    umask?: number;
    logger?: Logger;
  }) {
    db = db ?? await DB.createDB({
      dbKey,
      dbPath,
      logger: logger.getChild(DB.name)
    });
    devMgr = devMgr ?? new vfs.DeviceManager();
    iNodeMgr = iNodeMgr ?? await INodeManager.createINodeManager({
      db,
      devMgr,
      logger: logger.getChild(INodeManager.name)
    });
    // create root inode here
    const rootIno = iNodeMgr.inoAllocate();
    await iNodeMgr.transact(async (tran) => {
      // When this is not included TS thinks that it could be
      // undefined but I cant see why?
      if (!iNodeMgr) throw Error;
      tran.queueFailure(() => {
        if (!iNodeMgr) throw Error;
        iNodeMgr.inoDeallocate(rootIno);
      });
      await iNodeMgr.dirCreate(tran, rootIno, {
        mode: vfs.DEFAULT_ROOT_PERM,
        uid: vfs.DEFAULT_ROOT_UID,
        gid: vfs.DEFAULT_ROOT_GID
      });
    }, [rootIno]);
    const efs = new EncryptedFS({
      db,
      devMgr,
      iNodeMgr,
      rootIno,
      umask,
      logger
    });
    await efs.start();

    return efs;
  }

  // synchronous constructor for the instance
  protected constructor ({
    db,
    devMgr,
    iNodeMgr,
    rootIno,
    umask,
    logger
  }: {
    db: DB;
    devMgr: vfs.DeviceManager;
    iNodeMgr: INodeManager;
    rootIno: INodeIndex;
    umask: number,
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
    this.logger = logger;
  }

  get promises () {
    // return the promise based version of this
    // we can "return" this
    // but change the interface
    // createReadStream
    // createWriteStream
    // whatever right?
    // whatever provides the promise API
    return this;
  }

  public async start () {
    // start it up again
    // requires decryption keys
    // only after you stop it

    // create the initial root inode
    // well wait a minute
    // that's not exactly necessary

  }

  public async stop () {
    // shutdown the EFS instance
  }

  public async destroy (){
    // wipe out the entire FS
    await this.db.destroy();
  }

  public async access(path: path, mode?: number): Promise<void>;
  public async access(path: path, callback: Callback): Promise<void>;
  public async access(path: path, mode: number, callback: Callback): Promise<void>;
  public async access(
    path: path,
    modeOrCallback: number | Callback = vfs.constants.F_OK,
    callback?: Callback,
  ): Promise<void> {
    const mode = (typeof modeOrCallback !== 'function') ? modeOrCallback: vfs.constants.F_OK;
    callback = (typeof modeOrCallback === 'function') ? modeOrCallback : callback;
    return maybeCallback(async () => {
      path = this.getPath(path);
      const target = (await this.navigate(path, true)).target;
      if (!target) {
        throw new EncryptedFSError(errno.ENOENT, `access ${path} does not exist`);
      }
      if (mode === vfs.constants.F_OK) {
        return;
      }
      let targetStat;
      await this._iNodeMgr.transact(async (tran) => {
        targetStat = await this._iNodeMgr.statGet(tran, target);
      });
      if (!this.checkPermissions(mode, targetStat)) {
        throw new EncryptedFSError(errno.EACCES, `access ${path} does not exist`);
      }
    }, callback);
  }

  public async appendFile(file: path | FdIndex, data: data, options?: options): Promise<void>;
  public async appendFile(file: path | FdIndex, data: data, callback: Callback): Promise<void>;
  public async appendFile(file: path | FdIndex, data: data, options: options, callback: Callback): Promise<void>;
  public async appendFile(
    file: path | FdIndex,
    data: data = 'undefined',
    optionsOrCallback: options | Callback = { encoding: 'utf8', mode: vfs.DEFAULT_FILE_PERM, flag: 'a' },
    callback?: Callback,
  ): Promise<void> {
    const options = (typeof optionsOrCallback !== 'function') ? this.getOptions({ encoding: 'utf8' as BufferEncoding, mode: vfs.DEFAULT_FILE_PERM }, optionsOrCallback): { encoding: 'utf8', mode: vfs.DEFAULT_FILE_PERM } as options;
    callback = (typeof optionsOrCallback === 'function') ? optionsOrCallback : callback;
    return maybeCallback(async () => {
      options.flag = 'a';
      data = this.getBuffer(data, options.encoding);
      let fdIndex;
      try {
        let fd;
        if (typeof file === 'number') {
          fd = this._fdMgr.getFd(file);
          if (!fd) throw new EncryptedFSError(errno.EBADF, `appendFile '${fd}' invalid File Descriptor`);
          if (!(fd.flags & (vfs.constants.O_WRONLY | vfs.constants.O_RDWR))) {
            throw new EncryptedFSError(errno.EBADF, `appendFile '${fd}' invalide File Descriptor flags`);
          }
        } else {
          [fd, fdIndex] = await this._open(file as path, options.flag, options.mode);
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

  public async close(fdIndex: FdIndex, callback?: Callback): Promise<void> {
    return maybeCallback(async () => {
      if (!this._fdMgr.getFd(fdIndex)) {
        throw new EncryptedFSError(errno.EBADF, 'close');
      }
      await this._fdMgr.deleteFd(fdIndex);
    }, callback);
  }

  public async mkdir(path: path, mode?: number): Promise<void>;
  public async mkdir(path: path, callback: Callback): Promise<void>;
  public async mkdir(path: path, mode: number, callback: Callback): Promise<void>;
  public async mkdir(
    path: path,
    modeOrCallback: number | Callback = vfs.DEFAULT_DIRECTORY_PERM,
    callback?: Callback,
  ): Promise<void> {
    const mode = (typeof modeOrCallback !== 'function') ? modeOrCallback: vfs.DEFAULT_DIRECTORY_PERM;
    callback = (typeof modeOrCallback === 'function') ? modeOrCallback : callback;
    return maybeCallback(async () => {
      path = this.getPath(path);
      // we expect a non-existent directory
      path = path.replace(/(.+?)\/+$/, '$1');
      let navigated = await this.navigate(path, true);
      if (navigated.target) {
        throw new EncryptedFSError(errno.EEXIST, `mkdir '${path}' already exists`);
      } else if (!navigated.target && navigated.remaining) {
        throw new EncryptedFSError(errno.ENOENT, `mkdir '${path}' does not exist`);
      } else if (!navigated.target) {
        let navigatedDirStats;
        await this._iNodeMgr.transact(async (tran) => {
          navigatedDirStats = await this._iNodeMgr.statGet(tran, navigated.dir);
        }, [navigated.dir]);
        if (navigatedDirStats['nlink'] < 2) {
          throw new EncryptedFSError(errno.ENOENT, `mkdir '${path}' does not exist`);
        }
        if (!this.checkPermissions(
            vfs.constants.W_OK,
            navigatedDirStats
        )) {
          throw new EncryptedFSError(errno.EACCES, `mkdir '${path}' does not have correct permissions`);
        }
        const dirINode = this._iNodeMgr.inoAllocate();
        await this._iNodeMgr.transact(async (tran) => {
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
        }, [dirINode]);
        await this._iNodeMgr.transact(async (tran) => {
          await this._iNodeMgr.dirSetEntry(tran, navigated.dir, navigated.name, dirINode);
        }, [navigated.dir, dirINode]);
      }
    }, callback);
  }

  public async mkdirp(path: path, mode?: number): Promise<void>;
  public async mkdirp(path: path, callback: Callback): Promise<void>;
  public async mkdirp(path: path, mode: number, callback: Callback): Promise<void>;
  public async mkdirp(
    path: path,
    modeOrCallback: number | Callback = vfs.DEFAULT_DIRECTORY_PERM,
    callback?: Callback,
  ): Promise<void> {
    const mode = (typeof modeOrCallback !== 'function') ? modeOrCallback: vfs.DEFAULT_DIRECTORY_PERM;
    callback = (typeof modeOrCallback === 'function') ? modeOrCallback : callback;
    return maybeCallback(async () => {
      path = this.getPath(path);
      // we expect a directory
      path = path.replace(/(.+?)\/+$/, '$1');
      let currentDir, navigatedTargetType;
      let navigated = await this.navigate(path, true);
      while (true) {
        if (!navigated.target) {
          let navigatedDirStat;
          await this._iNodeMgr.transact(async (tran) => {
            navigatedDirStat = (await this._iNodeMgr.statGet(tran, navigated.dir));
          }, [navigated.dir]);
          if (navigatedDirStat.nlink < 2) {
            throw new EncryptedFSError(errno.ENOENT, `mkdirp '${path}' does not exist`);
          }
          if (!this.checkPermissions(
            vfs.constants.W_OK,
            navigatedDirStat
          )) {
            throw new EncryptedFSError(errno.EACCES, `mkdirp '${path}' does not have correct permissions`);
          }
          const dirInode = this._iNodeMgr.inoAllocate();
          await this._iNodeMgr.transact(async (tran) => {
            await this._iNodeMgr.dirCreate(
              tran,
              dirInode,
              {
                mode: vfs.applyUmask(mode, this._umask),
                uid: this._uid,
                gid: this._gid,
              },
              await this._iNodeMgr.dirGetEntry(tran, navigated.dir, '.'),
            );
            }, [dirInode]);
          await this._iNodeMgr.transact(async (tran) => {
            await this._iNodeMgr.dirSetEntry(tran, navigated.dir, navigated.name, dirInode);
          }, [navigated.dir]);
          if (navigated.remaining) {
            currentDir = dirInode;
            navigated = await this.navigateFrom(currentDir, navigated.remaining, true);
          } else {
            break;
          }
        } else {
          await this._iNodeMgr.transact(async (tran) => {
            // TODO: Investigate this
            if (!navigated.target) throw Error;
            navigatedTargetType = (await this._iNodeMgr.get(tran, navigated.target))?.type;
          }, [navigated.target]);
          if (navigatedTargetType !== 'Directory') {
            throw new EncryptedFSError(errno.ENOTDIR, `mkdirp '${path}' is not a directory`);
          }
          break;
        }
      }
    }, callback);
  }

  public async mkdtemp(pathSPrefix: string, options?: options): Promise<string | Buffer>;
  public async mkdtemp(pathSPrefix: string, callback: Callback): Promise<void>;
  public async mkdtemp(pathSPrefix: string, options: options, callback: Callback): Promise<void>;
  public async mkdtemp(
    pathSPrefix: path,
    optionsOrCallback: options | Callback = { encoding: 'utf8' },
    callback?: Callback,
  ): Promise<string | Buffer | void> {
    const options = (typeof optionsOrCallback !== 'function') ? this.getOptions({ encoding: 'utf8' }, optionsOrCallback) : { encoding: 'utf8' } as options;
    callback = (typeof optionsOrCallback === 'function') ? optionsOrCallback : callback;
    return maybeCallback(async () => {
      if (!pathSPrefix || typeof pathSPrefix !== 'string') {
        throw new TypeError('filename prefix is required');
      }
      const getChar = () => {
        const possibleChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return possibleChars[Math.floor(Math.random() * possibleChars.length)];
      };
      let pathS;
      while (true) {
        pathS = pathSPrefix.concat(
          Array.from({length: 6}, () => getChar).map((f) => f()).join('')
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

  public async open(path: path, flags: string | number, mode?: number): Promise<FdIndex>;
  public async open(path: path, flags: string | number, callback: Callback): Promise<void>;
  public async open(path: path, flags: string | number, mode: number, callback: Callback): Promise<void>;
  public async open(
    path: path,
    flags: string | number,
    modeOrCallback: number | Callback = vfs.DEFAULT_FILE_PERM,
    callback?: Callback,
  ): Promise<FdIndex | void> {
    const mode = (typeof modeOrCallback !== 'function') ? modeOrCallback : vfs.DEFAULT_FILE_PERM;
    callback = (typeof modeOrCallback === 'function') ? modeOrCallback : callback;
    return maybeCallback(async () => {
      return (await this._open(path, flags, mode))[1];
    }, callback);
  }

  protected async _open(
    path: path,
    flags: string | number,
    mode: number = vfs.DEFAULT_FILE_PERM,
  ): Promise<[FileDescriptor, FdIndex]> {
    path = this.getPath(path);
    if (typeof flags === 'string') {
      switch(flags) {
      case 'r':
      case 'rs':
        flags = vfs.constants.O_RDONLY;
        break;
      case 'r+':
      case 'rs+':
        flags = vfs.constants.O_RDWR;
        break;
      case 'w':
        flags = (vfs.constants.O_WRONLY |
                 vfs.constants.O_CREAT  |
                 vfs.constants.O_TRUNC);
        break;
      case 'wx':
        flags = (vfs.constants.O_WRONLY |
                 vfs.constants.O_CREAT  |
                 vfs.constants.O_TRUNC  |
                 vfs.constants.O_EXCL);
        break;
      case 'w+':
        flags = (vfs.constants.O_RDWR  |
                 vfs.constants.O_CREAT |
                 vfs.constants.O_TRUNC);
        break;
      case 'wx+':
        flags = (vfs.constants.O_RDWR  |
                 vfs.constants.O_CREAT |
                 vfs.constants.O_TRUNC |
                 vfs.constants.O_EXCL);
        break;
      case 'a':
        flags = (vfs.constants.O_WRONLY |
                 vfs.constants.O_APPEND |
                 vfs.constants.O_CREAT);
        break;
      case 'ax':
        flags = (vfs.constants.O_WRONLY |
                 vfs.constants.O_APPEND |
                 vfs.constants.O_CREAT  |
                 vfs.constants.O_EXCL);
        break;
      case 'a+':
        flags = (vfs.constants.O_RDWR   |
                 vfs.constants.O_APPEND |
                 vfs.constants.O_CREAT);
        break;
      case 'ax+':
        flags = (vfs.constants.O_RDWR   |
                 vfs.constants.O_APPEND |
                 vfs.constants.O_CREAT  |
                 vfs.constants.O_EXCL);
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
    // This is needed for the purpose of symlinks, if the navigated target exists
    // and is a symlink we need to go inside and check the target again. So a while
    // loop suits us best. In VFS this was easier as the type checking wasn't as strict
    while(true) {
      if(!target) {
        // O_CREAT only applies if there's a left over name without any remaining path
        if (!navigated.remaining && (flags & vfs.constants.O_CREAT)) {
          let navigatedDirStat;
          await this._iNodeMgr.transact(async (tran) => {
            navigatedDirStat = await this._iNodeMgr.statGet(tran, navigated.dir);
          }, [navigated.dir]);
          // cannot create if the current directory has been unlinked from its parent directory
          if (navigatedDirStat.nlink < 2) {
            throw new EncryptedFSError(errno.ENOENT, `open '${path}'`);
          }
          if (!this.checkPermissions(
            vfs.constants.W_OK,
            navigatedDirStat
          )) {
            throw new EncryptedFSError(errno.EACCES, `open '${path}'`);
          }
          const fileINode = this._iNodeMgr.inoAllocate();
          await this._iNodeMgr.transact(async (tran) => {
            await this._iNodeMgr.fileCreate(
              tran,
              fileINode,
              {
                mode: vfs.applyUmask(mode, this._umask),
                uid: this._uid,
                gid: this._gid
              }
            );
          }, [fileINode]);
          await this._iNodeMgr.transact(async (tran) => {
            await this._iNodeMgr.fileCreate(
              tran,
              fileINode,
              {
                mode: vfs.applyUmask(mode, this._umask),
                uid: this._uid,
                gid: this._gid
              }
            );
            await this._iNodeMgr.dirSetEntry(tran, navigated.dir, navigated.name, fileINode);
          }, [fileINode, navigated.dir]);
          target = fileINode;
          break;
        } else {
          throw new EncryptedFSError(errno.ENOENT, `open '${path}'`);
        }
      } else {
        const targetIno = target;
        let targetType;
        await this._iNodeMgr.transact(async (tran) => {
          targetType = (await this._iNodeMgr.get(tran, targetIno))?.type;
        });
        if (targetType === 'Symlink') {
          // cannot be symlink if O_NOFOLLOW
          if (flags & vfs.constants.O_NOFOLLOW) {
            throw new EncryptedFSError(errno.ELOOP, `open '${path}'`);
          }
          navigated = await this.navigateFrom(
            navigated.dir,
            navigated.name + navigated.remaining,
            true,
            undefined,
            undefined,
            path
          );
          target = navigated.target;
        } else {
          // target already exists cannot be created exclusively
          if ((flags & vfs.constants.O_CREAT) && (flags & vfs.constants.O_EXCL)) {
            throw new EncryptedFSError(errno.EEXIST, `open '${path}'`);
          }
          // cannot be directory if write capabilities are requested
          if ((targetType === 'Directory') &&
              (flags & (vfs.constants.O_WRONLY | flags & vfs.constants.O_RDWR)))
          {
            throw new EncryptedFSError(errno.EISDIR, `open '${path}'`);
          }
          // must be directory if O_DIRECTORY
          if ((flags & vfs.constants.O_DIRECTORY) && !(targetType === 'Directory')) {
            throw new EncryptedFSError(errno.ENOTDIR, `open '${path}'`);
          }
          // must truncate a file if O_TRUNC
          if ((flags & vfs.constants.O_TRUNC) &&
              (targetType === 'File') &&
              (flags & (vfs.constants.O_WRONLY | vfs.constants.O_RDWR)))
          {
            await this._iNodeMgr.transact(async (tran) => {
              await this._iNodeMgr.fileSetData(tran, targetIno, Buffer.alloc(0));
            }, [target]);
          }
          break;
        }
      }
    }
    // convert file descriptor access flags into bitwise permission flags
    let access;
    if (flags & vfs.constants.O_RDWR) {
      access = vfs.constants.R_OK | vfs.constants.W_OK;
    } else if (flags & vfs.constants.O_WRONLY) {
      access = vfs.constants.W_OK;
    } else {
      access = vfs.constants.R_OK;
    }
    const finalTarget = target;
    let targetStat;
    await this._iNodeMgr.transact(async (tran) => {
      targetStat = await this._iNodeMgr.statGet(tran, finalTarget);
    }, [target]);
    if (!this.checkPermissions(access, targetStat)) {
      throw new EncryptedFSError(errno.EACCES, `open '${path}'`);
    }
    try {
      return await this._fdMgr.createFd(target, flags);
    } catch (e) {
      if (e instanceof EncryptedFSError) {
        throw new EncryptedFSError(errno.EACCES, `open '${path}'`);
      }
      throw e;
    }
  }

  public async readdir(path: path, options?: options): Promise<Array<string | Buffer>>;
  public async readdir(path: path, callback: Callback): Promise<void>;
  public async readdir(path: path, options: options, callback: Callback): Promise<void>;
  public async readdir(
    path: path,
    optionsOrCallback?: options | Callback<[Array<string | Buffer>]>,
    callback?: Callback<[Array<string | Buffer>]>
  ): Promise<Array<string | Buffer> | void> {
    const options = (typeof optionsOrCallback !== 'function') ? this.getOptions({ encoding: 'utf8' }, optionsOrCallback): { encoding: 'utf8' as BufferEncoding };
    callback = (typeof optionsOrCallback === 'function') ? optionsOrCallback : callback;
    return maybeCallback(async () => {
      path = this.getPath(path);
      let navigated = await this.navigate(path, true);
      if (!navigated.target) {
        throw new EncryptedFSError(errno.ENOENT, `readdir '${path}' does not exist`);
      }
      let navigatedTargetType, navigatedTargetStat;
      const target = navigated.target;
      await this._iNodeMgr.transact(async (tran) => {
        navigatedTargetType = (await this._iNodeMgr.get(tran, target))?.type;
        navigatedTargetStat = await this._iNodeMgr.statGet(tran, target);
      }, [navigated.target]);
      if (navigatedTargetType !== 'Directory') {
        throw new EncryptedFSError(errno.ENOTDIR, `readdir '${path}' not a directory`);
      }
      if (!this.checkPermissions(vfs.constants.R_OK, navigatedTargetStat)) {
        throw new EncryptedFSError(errno.EACCES, `readdir '${path}' does ot have correct permissions`);
      }
      const navigatedTargetEntries: Array<[string | Buffer, INodeIndex]> = [];
      await this._iNodeMgr.transact(async (tran) => {
        for await (const dirEntry of this._iNodeMgr.dirGet(tran, target)) {
          navigatedTargetEntries.push(dirEntry);
        }
      }, [navigated.target]);
      return navigatedTargetEntries
        .filter(([name, _]) => name !== '.' && name !== '..')
        .map(([name, _]) => {
          if (options.encoding === 'binary') {
            return Buffer.from(name);
          } else {
            return Buffer.from(name).toString(options.encoding);
          }
        });
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
    activeSymlinks: Set<INodeIndex> = (new Set),
    origPathS: string = pathS,
  ): Promise<Navigated> {
    if (!pathS) {
      throw new EncryptedFSError(errno.ENOENT, origPathS);
    }
    // multiple consecutive slashes are considered to be 1 slash
    pathS = pathS.replace(/\/+/, '/');
    // a trailing slash is considered to refer to a directory, thus it is converted to /.
    // functions that expect and specially handle missing directories should trim it away
    pathS = pathS.replace(/\/$/, '/.');
    if (pathS[0] === '/') {
      pathS = pathS.substring(1);
      if (!pathS) {
        return {
          dir: this._root,
          target: this._root,
          // root is the only situation where the name is empty
          name: '',
          remaining: '',
          pathStack: []
        };
      } else {
        return await this.navigateFrom(
          this._root,
          pathS,
          resolveLastLink,
          activeSymlinks,
          [],
          origPathS
        );
      }
    } else {
      return await this.navigateFrom(
        this._cwd.ino,
        pathS,
        resolveLastLink,
        activeSymlinks,
        this._cwd.pathStack,
        origPathS
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
    activeSymlinks: Set<INodeIndex> = (new Set),
    pathStack: Array<string> = [],
    origPathS: string = pathS
  ): Promise<Navigated> {
    if (!pathS) {
      throw new EncryptedFSError(errno.ENOENT, origPathS);
    }
    let curdirStat;
    await this._iNodeMgr.transact(async (tran) => {
      curdirStat = await this._iNodeMgr.statGet(tran, curdir);
    }, [curdir]);
    if (!this.checkPermissions(vfs.constants.X_OK, curdirStat)) {
      throw new EncryptedFSError(errno.EACCES, `navigateFrom '${origPathS}' does not have correct permissions`);
    }
    let parse = this.parsePath(pathS);
    if (parse.segment !== '.') {
      if (parse.segment === '..') {
        // this is a noop if the pathStack is empty
        pathStack.pop();
      } else {
        pathStack.push(parse.segment);
      }
    }
    let nextDir, nextPath, target, targetType;
    await this._iNodeMgr.transact(async (tran) => {
      target = await this._iNodeMgr.dirGetEntry(tran, curdir, parse.segment);
    }, [curdir]);
    if(target) {
      await this._iNodeMgr.transact(async (tran) => {
        const targetData = await this._iNodeMgr.get(tran, target);
        targetType = targetData?.type;
      }, [target]);
      switch(targetType) {
        case 'File':
        case 'CharacterDev':
          if (!parse.rest) {
            return {
              dir: curdir,
              target: target,
              name: parse.segment,
              remaining: '',
              pathStack: pathStack
            };
          }
          throw new EncryptedFSError(errno.ENOTDIR, `navigateFrom '${origPathS}' not a directory`);
        case 'Directory':
          if (!parse.rest) {
            // if parse.segment is ., dir is not the same directory as target
            // if parse.segment is .., dir is the child directory
            return {
              dir: curdir,
              target: target,
              name: parse.segment,
              remaining: '',
              pathStack: pathStack
            };
          }
          nextDir = target;
          nextPath = parse.rest;
          break;
        case 'Symlink':
          if (!resolveLastLink && !parse.rest) {
            return {
              dir: curdir,
              target: target,
              name: parse.segment,
              remaining: '',
              pathStack: pathStack
            };
          }
          if (activeSymlinks.has(target)) {
            throw new EncryptedFSError(errno.ELOOP, `navigateFrom '${origPathS}' linked to itself`);
          } else {
            activeSymlinks.add(target);
          }
          // although symlinks should not have an empty links, it's still handled correctly here
          let targetLinks;
          await this._iNodeMgr.transact(async (tran) => {
            targetLinks = await this._iNodeMgr.symlinkGetLink(tran, target);
          }, [target]);
          nextPath = pathJoin(targetLinks, parse.rest);
          if (nextPath[0] === '/') {
            return this.navigate(
              nextPath,
              resolveLastLink,
              activeSymlinks,
              origPathS
            );
          } else {
            pathStack.pop();
            nextDir = curdir;
          }
          break;
        default:
          return {
            dir: curdir,
            target: undefined,
            name: parse.segment,
            remaining: parse.rest,
            pathStack: pathStack
          };
      }
    } else {
      return {
        dir: curdir,
        target: undefined,
        name: parse.segment,
        remaining: parse.rest,
        pathStack: pathStack
      };
    }
    return this.navigateFrom(
      nextDir,
      nextPath,
      resolveLastLink,
      activeSymlinks,
      pathStack,
      origPathS
    );
  }

  /**
   * Parses and extracts the first path segment.
   */
    protected parsePath(pathS: string): ParsedPath {
    const matches = pathS.match(/^([\s\S]*?)(?:\/+|$)([\s\S]*)/);
    if (matches) {
      let segment = matches[1] || '';
      let rest = matches[2] || '';
      return {
        segment: segment,
        rest: rest
      };
    } else {
      // this should not happen
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
   protected getPath(path: path): string {
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
      // must not allow encoded slashes
      throw new TypeError('ERR_INVALID_FILE_URL_PATH');
    }
    return decodeURIComponent(pathname);
  }

  /**
   * Takes a default set of options, and merges them shallowly into the user provided options.
   * Object spread syntax will ignore an undefined or null options object.
   */
  protected getOptions (
    defaultOptions: {
      encoding?: BufferEncoding | undefined,
      mode?: number,
      flag?: string
    },
    options?: options | BufferEncoding
  ): options {
    if (typeof options === 'string') {
      return {...defaultOptions, encoding: options};
    } else {
      return {...defaultOptions, ...options};
    }
  }

  /**
   * Processes data types and collapses it to a Buffer.
   * The data types can be Buffer or Uint8Array or string.
   */
   protected getBuffer(data: data, encoding: BufferEncoding | undefined = undefined): Buffer {
    if (data instanceof Buffer) {
      return data;
    }
    if (data instanceof Uint8Array) {
      // zero copy implementation
      // also sliced to the view's constraint
      return Buffer.from(data.buffer).slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      );
    }
    if (typeof data === 'string') {
      return Buffer.from(data, encoding);
    }
    throw new TypeError('data must be Buffer or Uint8Array or string');
  }
}

export default EncryptedFS;
