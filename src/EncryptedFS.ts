import type { Navigated, ParsedPath, Callback, path, options } from './types';
import type { INodeIndex } from './inodes/types';

import pathNode from 'path';
import Logger from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from './db';
import { INodeManager } from './inodes';
import CurrentDirectory from './CurrentDirectory';
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
  protected logger: Logger;
  protected _root: INodeIndex;
  protected _cwd: CurrentDirectory;
  protected _uid: number;
  protected _gid: number;
  protected _umask: number;

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
      await this._iNodeMgr.transact(async (tran) => {
        if (!navigated.target) throw new EncryptedFSError(errno.ENOENT, `readdir '${path}' does not exist`);
        navigatedTargetType = await this._iNodeMgr.get(tran, navigated.target);
        navigatedTargetStat = await this._iNodeMgr.statGet(tran, navigated.target);
      }, [navigated.target]);
      if (navigatedTargetType !== 'Directory') {
        throw new EncryptedFSError(errno.ENOTDIR, `readdir '${path}' not a directory`);
      }
      if (!this.checkPermissions(vfs.constants.R_OK, navigatedTargetStat)) {
        throw new EncryptedFSError(errno.EACCES, `readdir '${path}' does ot have correct permissions`);
      }
      const navigatedTargetEntries: Array<[string | Buffer, INodeIndex]> = [];
      await this._iNodeMgr.transact(async (tran) => {
        if (!navigated.target) throw new EncryptedFSError(errno.ENOENT, `readdir '${path}' does not exist`);
        for await (const dirEntry of this._iNodeMgr.dirGet(tran, navigated.target)) {
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
      const curdirData = await this._iNodeMgr.get(tran, curdir);
      targetType = curdirData?.type;
      target = await this._iNodeMgr.dirGetEntry(tran, curdir, parse.segment);
    }, [curdir]);
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
}

export default EncryptedFS;
