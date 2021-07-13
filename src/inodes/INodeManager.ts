import type { MutexInterface } from 'async-mutex';
import type { DeviceManager } from 'virtualfs';
import type { INodeIndex, INodeId, INodeType, INodeData } from './types';
import type { DB } from '../db';
import type { StatProps } from '../Stat';
import type { DBDomain, DBLevel, DBOps, DBTransaction } from '../db/types';
import type { Callback } from '../types';

import * as vfs from 'virtualfs';
import Logger from '@matrixai/logger';
import { Mutex } from 'async-mutex';
import * as inodesUtils from './utils';
import * as inodesErrors from './errors';
import { maybeCallback } from '../utils';
import Stat from '../Stat';

type INodeParams = Partial<StatProps> & Pick<StatProps, 'ino' | 'mode'>;
type FileParams = Partial<Omit<INodeParams, 'ino'>>;
type DirectoryParams = Partial<Omit<INodeParams, 'ino'>>;
type SymlinkParams = Partial<Omit<INodeParams, 'ino'>>;
type CharDevParams = Partial<Omit<INodeParams, 'ino'>>;

class INodeManager {

  public static async createINodeManager(
    options: {
      db: DB,
      devMgr: DeviceManager,
      counter?: number;
      logger?: Logger;
    }
  ): Promise<INodeManager>;
  public static async createINodeManager(
    options: {
      db: DB,
      devMgr: DeviceManager,
      counter?: number;
      logger?: Logger;
    },
    callback: Callback<[INodeManager]>
  ): Promise<void>;
  public static async createINodeManager(
    {
      db,
      devMgr,
      counter = 0,
      logger = new Logger(INodeManager.name),
    }: {
      db: DB;
      devMgr: DeviceManager;
      counter?: number;
      logger?: Logger;
    },
    callback?: Callback<[INodeManager]>
  ): Promise<INodeManager | void> {
    return maybeCallback(async () => {
      const iNodeMgrDbDomain = INodeManager.name;
      const iNodesDbDomain: DBDomain = [iNodeMgrDbDomain, 'inodes'];
      const iNodesStatDbDomain: DBDomain = [iNodeMgrDbDomain, 'stat'];
      const iNodesDataDbDomain: DBDomain = [iNodeMgrDbDomain, 'data'];
      const iNodesDirDbDomain: DBDomain = [iNodeMgrDbDomain, 'dir'];
      const iNodesLinkDbDomain: DBDomain = [iNodeMgrDbDomain, 'link'];
      const iNodeMgrDb = await db.level(iNodeMgrDbDomain);
      const iNodesDb = await db.level(iNodesDbDomain[1], iNodeMgrDb);
      const iNodesStatDb = await db.level(iNodesStatDbDomain[1], iNodeMgrDb);
      const iNodesDataDb = await db.level(iNodesDataDbDomain[1], iNodeMgrDb);
      const iNodesDirDb = await db.level(iNodesDirDbDomain[1], iNodeMgrDb);
      const iNodesLinkDb = await db.level(iNodesLinkDbDomain[1], iNodeMgrDb);
      for await (const k of iNodesDb.createKeyStream({
        reverse: true,
        limit: 1
      })) {
        counter = inodesUtils.uniNodeId(k as INodeId);
      }
      return new INodeManager({
        db,
        devMgr,
        counter,
        logger,
        iNodesDbDomain,
        iNodesDb,
        iNodesStatDbDomain,
        iNodesStatDb,
        iNodesDataDbDomain,
        iNodesDataDb,
        iNodesDirDbDomain,
        iNodesDirDb,
        iNodesLinkDbDomain,
        iNodesLinkDb
      });
    }, callback);
  }

  public iNodeMgrDbDomain: string;
  public iNodesDbDomain: DBDomain;
  public iNodesStatDbDomain: DBDomain;
  public iNodesDataDbDomain: DBDomain;
  public iNodesDirDbDomain: DBDomain;
  public iNodesLinkDbDomain: DBDomain;

  protected logger: Logger;
  protected _db: DB;
  protected _devMgr: DeviceManager;
  protected counter: number;

  protected _iNodeMgrDb: DBLevel;
  protected _iNodesDb: DBLevel;
  protected _iNodesStatDb: DBLevel;
  protected _iNodesDataDb: DBLevel;
  protected _iNodesDirDb: DBLevel;
  protected _iNodesLinkDb: DBLevel;

  protected lock: MutexInterface = new Mutex;

  // should you put newly created inodes here?
  // so that way if they are dangling?
  // public iNodesGcDbDomain: DBDomain;
  // public iNodePool: Map<number, { lock: Mutex, iNode?: INode }> = new Map;
  // public iNodeRefs: WeakMap<INode, number> = new Map;
  // protected _iNodesGcDb: DBLevel;

  protected constructor (
    {
      db,
      devMgr,
      counter,
      logger,
      iNodesDbDomain,
      iNodesDb,
      iNodesStatDbDomain,
      iNodesStatDb,
      iNodesDataDbDomain,
      iNodesDataDb,
      iNodesDirDbDomain,
      iNodesDirDb,
      iNodesLinkDbDomain,
      iNodesLinkDb
    }: {
      db: DB,
      devMgr: DeviceManager,
      counter: number;
      logger: Logger,
      iNodesDbDomain: DBDomain;
      iNodesDb: DBLevel;
      iNodesStatDbDomain: DBDomain;
      iNodesStatDb: DBLevel;
      iNodesDataDbDomain: DBDomain;
      iNodesDataDb: DBLevel;
      iNodesDirDbDomain: DBDomain;
      iNodesDirDb: DBLevel;
      iNodesLinkDbDomain: DBDomain;
      iNodesLinkDb: DBLevel;
    }
  ) {
    this.logger = logger;
    this._db = db;
    this._devMgr = devMgr;
    this.counter = counter;
    this.iNodesDbDomain = iNodesDbDomain;
    this._iNodesDb = iNodesDb;
    this.iNodesStatDbDomain = iNodesStatDbDomain;
    this._iNodesStatDb = iNodesStatDb;
    this.iNodesDataDbDomain = iNodesDataDbDomain;
    this._iNodesDataDb = iNodesDataDb;
    this.iNodesDirDbDomain = iNodesDirDbDomain;
    this._iNodesDirDb = iNodesDirDb;
    this.iNodesLinkDbDomain = iNodesLinkDbDomain;
    this._iNodesLinkDb = iNodesLinkDb;
  }

  get db(): DB {
    return this._db;
  }

  get devMgr(): DeviceManager {
    return this._devMgr;
  }

  get iNodeMgrDb(): DBLevel {
    return this._iNodeMgrDb;
  }

  get iNodesDb(): DBLevel {
    return this._iNodesDb;
  }

  get iNodesStatDb(): DBLevel {
    return this._iNodesStatDb;
  }

  get iNodesDataDb(): DBLevel {
    return this._iNodesDataDb;
  }

  get iNodesDirDb(): DBLevel {
    return this._iNodesDirDb;
  }

  get iNodesLinkDb(): DBLevel {
    return this._iNodesLinkDb;
  }



  /*
    LOCKING IS DONE HERE
    ALL LOCKS IS HANDLED on a per-inode basis
    Unlinking is separate from running gcINodeOps
    Anything that calls that has to deal with that
    So GC may be done separately
  */

  // we need a to provide a pool of locks
  // so you can "acquire" the lock
  // now that db.transaction(async (t) => { ... }, [parentLock, childLock])
  // is used, this makes it easier to make use of
  // the idea is that we lock according to the parent and child
  // since the DB is injected here
  // we can abstract the get operation
  // so that we do operations with respect to relevant inodes
  // then we just have `dirCreate(t)` and `link(t)` ... etc


  public async transactionINode<T>(ino: INodeIndex, f: (that: this) => Promise<T>): Promise<T>;
  public async transactionINode(ino: INodeIndex, f: (that: this) => void): Promise<void>;
  public async transactionINode(ino: INodeIndex, f: any): Promise<any | void> {

    // this maintains a pool of inodes

    // this will "lock"

  }

  protected async iNodeCreate(
    tran: DBTransaction,
    type: INodeType,
    params: INodeParams,
  ): Promise<void> {
    const statDbDomain = [...this.iNodesStatDbDomain, params.ino.toString()];
    params.dev = params.dev ?? 0;
    params.nlink = params.nlink ?? 0;
    params.uid = params.uid ?? vfs.DEFAULT_ROOT_UID;
    params.gid = params.gid ?? vfs.DEFAULT_ROOT_GID;
    params.rdev = params.rdev ?? 0;
    params.size = params.size ?? 0;
    params.blksize = params.blksize ?? 0;
    params.blocks = params.blocks ?? 0;
    const now = new Date;
    params.atime = params.atime ?? now;
    params.mtime = params.mtime ?? now;
    params.ctime = params.ctime ?? now;
    params.birthtime = params.birthtime ?? now;
    await tran.put(this.iNodesDbDomain, inodesUtils.iNodeId(params.ino), type);
    await tran.put(statDbDomain, 'ino', params.ino);
    for (const [key, value] of Object.entries(params)) {
      switch (key) {
        case 'dev':
        case 'mode':
        case 'nlink':
        case 'uid':
        case 'gid':
        case 'rdev':
        case 'size':
        case 'blksize':
        case 'blocks':
          await tran.put(statDbDomain, key, value);
          break;
        case 'atime':
        case 'mtime':
        case 'ctime':
        case 'birthtime':
          await tran.put(statDbDomain, key, (value as Date).getTime());
          break;
      }
    }
  }

  /**
   * Counter update is not transactional unfortunately.
   * The DB would require us an incremental counter.
   * An on-write counter would have to be used.
   * But also until you "commit" the transaction, you cannot have the counter.
   * Here we are creating a counter immediately, and then passing it so you can
   * compose it with other operations on the same counter.
   * So it's a ahead of time counter.
   * So technically you can do `counter.allocate` here at the very least
   * And then deallocate if it is really not used. That way it's always unique.
   */
  public async fileCreate(
    tran: DBTransaction,
    params: FileParams,
    data?: Buffer
  ): Promise<INodeIndex> {
    const ino = ++this.counter;
    const mode = vfs.constants.S_IFREG | ((params.mode ?? 0) & (~vfs.constants.S_IFMT));
    await this.iNodeCreate(tran, 'File', {
      ...params,
      ino,
      mode
    });
    // TODO:
    // add in buffer creation (from data)
    return ino;
  }

  public async dirCreate(
    tran: DBTransaction,
    params: DirectoryParams,
    parent?: INodeIndex,
  ): Promise<INodeIndex> {
    const ino = ++this.counter;
    const mode = vfs.constants.S_IFDIR | ((params.mode ?? 0) & (~vfs.constants.S_IFMT));
    const dirDbDomain = [...this.iNodesDirDbDomain, ino.toString()];
    let nlink: number;
    if (parent == null) {
      nlink = 2;
      parent = ino;
    } else {
      nlink = 1;
    }
    await this.iNodeCreate(
      tran,
      'Directory',
      {
        ...params,
        ino,
        mode,
        nlink,
      }
    );
    if (nlink === 1) {
      await this.link(tran, parent);
    }
    await tran.put(dirDbDomain, '.', ino);
    await tran.put(dirDbDomain, '..', parent);
    return ino;
  }

  public async symlinkCreate(
    tran: DBTransaction,
    params: SymlinkParams,
    link: string,
  ): Promise<INodeIndex> {
    const ino = ++this.counter;
    const mode = vfs.constants.S_IFLNK | ((params.mode ?? 0) & (~vfs.constants.S_IFMT));
    await this.iNodeCreate(
      tran,
      'Symlink',
      {
        ...params,
        ino,
        mode
      }
    );
    await tran.put(this.iNodesLinkDbDomain, inodesUtils.iNodeId(ino), link);
    return ino;
  }

  public async charDevCreate(
    tran: DBTransaction,
    params: CharDevParams,
  ): Promise<INodeIndex> {
    const ino = ++this.counter;
    const mode = vfs.constants.S_IFCHR | ((params.mode ?? 0) & (~vfs.constants.S_IFMT));
    await this.iNodeCreate(
      tran,
      'CharacterDev',
      {
        ...params,
        ino,
        mode
      }
    );
    return ino;
  }

  protected async iNodeDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    const statDbDomain = [...this.iNodesStatDbDomain, ino.toString()];
    const keys = [
      'dev',
      'ino',
      'mode',
      'nlink',
      'uid',
      'gid',
      'rdev',
      'size',
      'blksize',
      'blocks',
      'atime',
      'mtime',
      'ctime',
      'birthtime'
    ];
    for (const k of keys) {
      await tran.del(statDbDomain, k);
    }
    await tran.del(this.iNodesDbDomain, inodesUtils.iNodeId(ino));
  }

  public async fileDestroy(
    tran: DBTransaction,
    ino: INodeIndex
  ): Promise<void> {
    const dataDbDomain = [...this.iNodesDataDbDomain, ino.toString()];
    const dataDb = await this.db.level(ino.toString(), this.iNodesDataDb);
    for await (const k of dataDb.createKeyStream()) {
      await tran.del(dataDbDomain, k);
    }
    await this.iNodeDestroy(tran, ino);
  }

  public async dirDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    const dirDbDomain = [...this.iNodesDirDbDomain, ino.toString()];
    const dirDb = await this.db.level(ino.toString(), this.iNodesDirDb);
    const parent = (await tran.get<number>(dirDbDomain, '..'))!;
    if (parent !== ino) {
      await this.unlink(tran, ino);
    }
    for await (const k of dirDb.createKeyStream()) {
      await tran.del(dirDbDomain, k);
    }
    await this.iNodeDestroy(tran, ino);
  }

  public async symlinkDestroy(
    tran: DBTransaction,
    ino: INodeIndex
  ): Promise<void> {
    await tran.del(this.iNodesLinkDbDomain, inodesUtils.iNodeId(ino));
    await this.iNodeDestroy(tran, ino);
  }

  public async charDevDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    await this.iNodeDestroy(tran, ino);
  }

  public async getLock(tran: DBTransaction, ino: INodeIndex): Promise<MutexInterface> {

    // return the inode type
    // return the LOCK
    // the idea is that this "fetches" a lock for this
    // for this inode
    // do you need the type as well?
    // or is that a separate operation?

  }

  public async getType(tran: DBTransaction, ino: INodeIndex): Promise<INodeType> {
    const type = await tran.get<INodeType>(
      this.iNodesDbDomain,
      inodesUtils.iNodeId(ino),
    );
    return type!;
  }

  public async link(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    const nlink = await this.statGetProp(tran, ino, 'nlink');
    await this.statSetProp(tran, ino, 'nlink', nlink + 1);
  }

  public async unlink (
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    const nlink = await this.statGetProp(tran, ino, 'nlink');
    await this.statSetProp(tran, ino, 'nlink', nlink - 1);
    await this.gc(tran, ino);
  }

  public async gc(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    const nlink = await this.statGetProp(tran, ino, 'nlink');
    const type = (await tran.get<INodeType>(
      this.iNodesDbDomain,
      inodesUtils.iNodeId(ino),
    ))!;

    // one issue is that ref count drops
    // require locking too?
    // or how does that work?
    // get the ref count too!
    // like ref count will need to "lock" the inode operations too
    const useCount = nlink;

    if (useCount === 0 || (useCount === 1 && type === 'Directory')) {
      switch (type) {
        case 'File':
          await this.fileDestroy(tran, ino);
          break;
        case 'Directory':
          await this.dirDestroy(tran, ino);
          break;
        case 'Symlink':
          await this.symlinkDestroy(tran, ino);
          break;
        case 'CharacterDev':
          await this.charDevDestroy(tran, ino);
          break;
      }
      tran.queue(() => {
        // deallocate the counter
        // delete the inode lock
      });
    }
  }

  public async statGet(tran: DBTransaction, ino: INodeIndex): Promise<Stat> {
    const domain = [...this.iNodesStatDbDomain, ino.toString()];
    const props: Array<any> = await Promise.all([
      tran.get<number>(domain, 'dev'),
      tran.get<number>(domain, 'mode'),
      tran.get<number>(domain, 'nlink'),
      tran.get<number>(domain, 'uid'),
      tran.get<number>(domain, 'gid'),
      tran.get<number>(domain, 'rdev'),
      tran.get<number>(domain, 'size'),
      tran.get<number>(domain, 'blksize'),
      tran.get<number>(domain, 'blocks'),
      tran.get<number>(domain, 'atime'),
      tran.get<number>(domain, 'mtime'),
      tran.get<number>(domain, 'ctime'),
      tran.get<number>(domain, 'birthtime'),
    ]);
    const [
      dev, mode, nlink, uid, gid, rdev, size, blksize, blocks,
      atime, mtime, ctime, birthtime
    ] = props;
    return new Stat({
      dev, ino, mode, nlink, uid, gid, rdev, size, blksize, blocks,
      atime: new Date(atime),
      mtime: new Date(mtime),
      ctime: new Date(ctime),
      birthtime: new Date(birthtime)
    });
  }

  public async statGetProp<Key extends keyof StatProps>(
    tran: DBTransaction,
    ino: INodeIndex,
    key: Key,
  ): Promise<StatProps[Key]> {
    const domain = [...this.iNodesStatDbDomain, ino.toString()];
    let value;
    switch (key) {
      case 'dev':
      case 'ino':
      case 'mode':
      case 'nlink':
      case 'uid':
      case 'gid':
      case 'rdev':
      case 'size':
      case 'blksize':
      case 'blocks':
        value = (await tran.get<number>(domain, key))!
        break;
      case 'atime':
      case 'mtime':
      case 'ctime':
      case 'birthtime':
        value = new Date((await tran.get<number>(domain, key))!);
        break;
    }
    return value;
  }

  public async statSetProp<Key extends keyof StatProps>(
    tran: DBTransaction,
    ino: INodeIndex,
    key: Key,
    value: StatProps[Key]
  ): Promise<void> {
      const domain = [...this.iNodesStatDbDomain, ino.toString()];
      switch (key) {
        case 'dev':
        case 'ino':
        case 'mode':
        case 'nlink':
        case 'uid':
        case 'gid':
        case 'rdev':
        case 'size':
        case 'blksize':
        case 'blocks':
          await tran.put(domain, key, value);
          break;
        case 'atime':
        case 'mtime':
        case 'ctime':
        case 'birthtime':
          await tran.put(domain, key, (value as Date).getTime());
          break;
      }
  }

  public async statUnsetProp<Key extends keyof StatProps>(
    tran: DBTransaction,
    ino: INodeIndex,
    key: Key,
  ): Promise<void> {
    const domain = [...this.iNodesStatDbDomain, ino.toString()];
    await tran.del(domain, key);
  }

  /**
   * Iterators are not part of our snapshot yet
   */
  public async *dirGet(
    tran: DBTransaction,
    ino: INodeIndex
  ): AsyncGenerator<[string, INodeIndex]>{
    const dirDb = await this.db.level(ino.toString(), this.iNodesDirDb);
    for await (const o of dirDb.createReadStream()) {
      const name = (o as any).key.toString('utf-8') as string;
      const value = (o as any).value as INodeIndex;
      yield [name, value];
    }
  }

  public async dirGetEntry(
    tran: DBTransaction,
    ino: INodeIndex,
    name: string,
  ): Promise<number | undefined> {
    const domain = [...this.iNodesDirDbDomain, ino.toString()];
    return tran.get<number>(domain, name);
  }

  public async dirSetEntry(
    tran: DBTransaction,
    ino: INodeIndex,
    name: string,
    value: INodeIndex
  ): Promise<void> {
    const domain = [...this.iNodesDirDbDomain, ino.toString()];
    const existingValue = await tran.get<INodeIndex>(domain, name);
    if (existingValue === value) {
      return;
    }
    const now = new Date;
    await tran.put(domain, name, value);
    await this.statSetProp(tran, ino, 'mtime', now);
    await this.statSetProp(tran, ino, 'ctime', now);
    await this.link(tran, value);
    if (existingValue != null) {
      await this.unlink(tran, existingValue);
    }
  }

  public async dirUnsetEntry(
    tran: DBTransaction,
    ino: INodeIndex,
    name: string,
  ): Promise<void> {
    const domain = [...this.iNodesDirDbDomain, ino.toString()];
    const now = new Date;
    const existingValue = await tran.get<INodeIndex>(domain, name);
    if (existingValue == null) {
      return;
    }
    await tran.del(domain, name);
    await this.statSetProp(tran, ino, 'mtime', now);
    await this.statSetProp(tran, ino, 'ctime', now);
    await this.unlink(tran, existingValue);
  }

  public async symlinkGetLink(
    tran: DBTransaction,
    ino: INodeIndex
  ): Promise<string> {
    const link = await tran.get<string>(
      this.iNodesLinkDbDomain,
      inodesUtils.iNodeId(ino)
    );
    return link!;
  }

  public async charDevGetFileDesOps(
    tran: DBTransaction,
    ino: INodeIndex
  ): Promise<vfs.DeviceInterface<vfs.CharacterDev> | undefined> {
    const rdev = await this.statGetProp(tran, ino, 'rdev');
    const [major, minor] = vfs.unmkDev(rdev);
    return this.devMgr.getChr(major, minor);
  }




  // /**
  //  * Gets an inode in concurrency-safe manner
  //  */
  // public async getINode(iNodeIndex: INodeIndex): Promise<INode | undefined>;
  // public async getINode(iNodeIndex: INodeIndex, callback: Callback<[INode | undefined]>): Promise<void>;
  // public async getINode(iNodeIndex: INodeIndex, callback?: Callback<[INode | undefined]>): Promise<INode | undefined | void> {
  //   if (callback == null) {
  //     let entry = this.iNodePool.get(iNodeIndex);
  //     if (entry?.iNode != null) {
  //       return entry.iNode;
  //     }
  //     let entryExists = true;
  //     if (entry == null) {
  //       entryExists = true;
  //       // pre-emptively setup a lock
  //       // other contexts will now block and wait for this context to complete
  //       entry = { lock: new Mutex };
  //       this.iNodePool.set(iNodeIndex, entry);
  //     }
  //     const release = await entry.lock.acquire();
  //     try {
  //       // if another context has loaded the inode, just return it
  //       if (entry?.iNode != null) {
  //         return entry.iNode;
  //       }
  //       const iNodeData = await this._db.get<INodeData>(
  //         this.iNodesDbDomain,
  //         inodesUtils.iNodeId(iNodeIndex)
  //       );
  //       // if there's no such inode in the database
  //       // make sure to delete from the pool
  //       if (iNodeData == null) {
  //         this.iNodePool.delete(iNodeIndex);
  //         return;
  //       }
  //       let iNode: INode;
  //       switch (iNodeData.type) {
  //         case 'File':
  //           iNode = await File.loadFile({
  //             iNodeIndex,
  //             iNodeMgr: this,
  //             lock: entry.lock,
  //           });
  //           break;
  //         case 'Directory':
  //           iNode = await Directory.loadDirectory({
  //             iNodeIndex,
  //             iNodeMgr: this,
  //             lock: entry.lock,
  //           });
  //           break;
  //         case 'Symlink':
  //           iNode = await Symlink.loadSymlink({
  //             iNodeIndex,
  //             iNodeMgr: this,
  //             lock: entry.lock
  //           });
  //           break;
  //         case 'CharacterDev':
  //           iNode = await CharacterDev.loadCharacterDev({
  //             iNodeIndex,
  //             iNodeMgr: this,
  //             lock: entry.lock
  //           });
  //           break;
  //       }
  //       // update the pool entry with the new inode!
  //       entry.iNode = iNode;
  //       return iNode;
  //     } catch (e) {
  //       // only remove if originally the entry did not exist
  //       if (!entryExists) {
  //         this.iNodePool.delete(iNodeIndex);
  //       }
  //       throw e;
  //     } finally {
  //       release();
  //     }
  //   } else {
  //     callbackify<INodeIndex, INode | undefined>(this.getINode.bind(this))(iNodeIndex, callback);
  //     return;
  //   }
  // }


  // /**
  //  * References an inode, this increments the private reference count.
  //  * Private reference count can be used by file descriptors and working directory position.
  //  * The reference count always starts at 0 for iNodes that are not yet in this.iNodeRefs
  //  */
  // public async refINode(iNode: INode): Promise<void>;
  // public async refINode(iNode: INode, callback: Callback): Promise<void>;
  // public async refINode(iNode: INode, callback?: Callback): Promise<void> {
  //   if (callback == null) {
  //     // before creating an inode meant that it existed in the iNodeRefs
  //     // now there may be inodes that are still on disk
  //     // so by default if it doesn't exist, it is defaulted to 0
  //     const refCount = this.iNodeRefs.get(iNode) ?? 0;
  //     this.iNodeRefs.set(iNode, refCount + 1);
  //     return;
  //   } else {
  //     callbackify<INode, void>(this.refINode.bind(this))(iNode, callback);
  //     return;
  //   }
  // }

  // /**
  //  * Unreferences an inode, this decrements the private reference count.
  //  */
  // public async unrefINode (iNode: INode): Promise<void>;
  // public async unrefINode (iNode: INode, callback: Callback): Promise<void>;
  // public async unrefINode (iNode: INode, callback?: Callback): Promise<void> {
  //   const refCount = this.iNodeRefs.get(iNode);
  //   if (callback == null) {
  //     if (refCount == null) {
  //       return;
  //     }
  //     this.iNodeRefs.set(iNode, refCount - 1);
  //     return await this.gcINode(iNode);
  //   } else {
  //     callbackify<INode, void>(this.unrefINode.bind(this))(iNode, callback);
  //     return;
  //   }
  // }

}

export default INodeManager;
