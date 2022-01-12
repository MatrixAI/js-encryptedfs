import type { MutexInterface } from 'async-mutex';
import type { INodeIndex, INodeId, INodeType, INodeData } from './types';
import type { DB, DBDomain, DBLevel, DBTransaction } from '@matrixai/db';
import type { StatProps } from '../Stat';

import { Mutex } from 'async-mutex';
import Counter from 'resource-counter';
import Logger from '@matrixai/logger';
import {
  CreateDestroyStartStop,
  ready,
} from '@matrixai/async-init/dist/CreateDestroyStartStop';
import * as inodesUtils from './utils';
import * as inodesErrors from './errors';
import Stat from '../Stat';
import * as constants from '../constants';
import * as permissions from '../permissions';
import * as utils from '../utils';

type INodeParams = Partial<StatProps> & Pick<StatProps, 'ino' | 'mode'>;
type FileParams = Partial<Omit<INodeParams, 'ino'>>;
type DirectoryParams = Partial<Omit<INodeParams, 'ino'>>;
type SymlinkParams = Partial<Omit<INodeParams, 'ino'>>;

interface INodeManager extends CreateDestroyStartStop {}
@CreateDestroyStartStop(
  new inodesErrors.ErrorINodesRunning(),
  new inodesErrors.ErrorINodesDestroyed(),
)
class INodeManager {
  public static async createINodeManager({
    db,
    logger = new Logger(this.name),
    fresh = false,
  }: {
    db: DB;
    counter?: Counter;
    logger?: Logger;
    fresh?: boolean;
  }): Promise<INodeManager> {
    logger.info(`Creating ${this.name}`);
    const iNodeMgr = new INodeManager({
      db,
      logger,
    });
    await iNodeMgr.start({ fresh });
    logger.info(`Created ${this.name}`);
    return iNodeMgr;
  }

  public mgrDomain: DBDomain;
  public iNodesDomain: DBDomain;
  public statsDomain: DBDomain;
  public dataDomain: DBDomain;
  public dirsDomain: DBDomain;
  public linkDomain: DBDomain;
  public gcDomain: DBDomain;

  protected logger: Logger;
  protected _db: DB;
  protected mgrDb: DBLevel;
  protected iNodesDb: DBLevel;
  protected statsDb: DBLevel;
  protected dataDb: DBLevel;
  protected dirsDb: DBLevel;
  protected linkDb: DBLevel;
  protected gcDb: DBLevel;
  protected counter: Counter = new Counter(1);
  protected refs: Map<INodeIndex, number> = new Map();
  protected locks: Map<INodeIndex, MutexInterface> = new Map();

  constructor({ db, logger }: { db: DB; logger: Logger }) {
    this.logger = logger;
    this._db = db;
  }

  public async start({ fresh = false }: { fresh?: boolean }): Promise<void> {
    this.logger.info(`Starting ${this.constructor.name}`);
    const mgrDomain: DBDomain = [INodeManager.name];
    const iNodesDomain: DBDomain = [mgrDomain[0], 'inodes'];
    const statsDomain: DBDomain = [mgrDomain[0], 'stat'];
    const dataDomain: DBDomain = [mgrDomain[0], 'data'];
    const dirsDomain: DBDomain = [mgrDomain[0], 'dir'];
    const linkDomain: DBDomain = [mgrDomain[0], 'link'];
    const gcDomain: DBDomain = [mgrDomain[0], 'gc'];
    const mgrDb = await this.db.level(mgrDomain[0]);
    const iNodesDb = await this.db.level(iNodesDomain[1], mgrDb);
    const statsDb = await this.db.level(statsDomain[1], mgrDb);
    const dataDb = await this.db.level(dataDomain[1], mgrDb);
    const dirsDb = await this.db.level(dirsDomain[1], mgrDb);
    const linkDb = await this.db.level(linkDomain[1], mgrDb);
    const gcDb = await this.db.level(gcDomain[1], mgrDb);
    if (fresh) {
      await mgrDb.clear();
    }
    // Populate the inode counter with pre-existing inodes
    for await (const k of iNodesDb.createKeyStream()) {
      this.counter.allocate(inodesUtils.uniNodeId(k as INodeId));
    }
    this.mgrDomain = mgrDomain;
    this.iNodesDomain = iNodesDomain;
    this.statsDomain = statsDomain;
    this.dataDomain = dataDomain;
    this.dirsDomain = dirsDomain;
    this.linkDomain = linkDomain;
    this.gcDomain = gcDomain;
    this.mgrDb = mgrDb;
    this.iNodesDb = iNodesDb;
    this.statsDb = statsDb;
    this.dataDb = dataDb;
    this.dirsDb = dirsDb;
    this.linkDb = linkDb;
    this.gcDb = gcDb;
    // Clean up all dangling inodes that could not be removed due to references
    // This only has effect when `this.stop` was not called during a prior instance
    await this.gcAll();
    this.logger.info(`Started ${this.constructor.name}`);
  }

  /**
   * It is expected that all references and locks are no longer active
   * This means users of INodeManager must be stopped before calling this
   */
  public async stop(): Promise<void> {
    this.logger.info(`Stopping ${this.constructor.name}`);
    // Clean up all dangling inodes that could not be removed due to references
    await this.gcAll();
    // Reset the inode counter, it will be repopulated on start
    this.counter = new Counter(1);
    // Reset the references
    this.refs.clear();
    // Reset the locks
    this.locks.clear();
    this.logger.info(`Stopped ${this.constructor.name}`);
  }

  public async destroy(): Promise<void> {
    this.logger.info(`Destroying ${this.constructor.name}`);
    // If the DB was stopped, the existing sublevel `this.mgrDb` will not be valid
    // Therefore we recreate the sublevel here
    const mgrDb = await this.db.level(this.mgrDomain[0]);
    await mgrDb.clear();
    this.logger.info(`Destroyed ${this.constructor.name}`);
  }

  /**
   * Delete iNodes that were scheduled for deletion
   * These iNodes could not be deleted because of an existing reference
   * This is used during `this.start` and `this.stop`
   * This must only be called when there are no active `this.refs` or `this.locks`
   */
  protected async gcAll(): Promise<void> {
    for await (const k of this.gcDb.createKeyStream()) {
      await this.db.transact(async (tran) => {
        const ino = inodesUtils.uniNodeId(k as INodeId);
        const type = (await tran.get<INodeType>(
          this.iNodesDomain,
          inodesUtils.iNodeId(ino),
        ))!;
        // Delete the on-disk state
        switch (type) {
          case 'File':
            await this._fileDestroy(tran, ino);
            break;
          case 'Directory':
            await this._dirDestroy(tran, ino);
            break;
          case 'Symlink':
            await this._symlinkDestroy(tran, ino);
            break;
        }
        tran.queueSuccess(() => {
          this.refs.delete(ino);
          this.locks.delete(ino);
          this.inoDeallocate(ino);
        });
      });
    }
  }

  get db(): DB {
    return this._db;
  }

  public inoAllocate(): INodeIndex {
    return this.counter.allocate();
  }

  public inoDeallocate(ino: INodeIndex): void {
    return this.counter.deallocate(ino);
  }

  /**
   * By default will not lock anything
   */
  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async transact<T>(
    f: (t: DBTransaction) => Promise<T>,
    inos: Array<INodeIndex> = [],
  ) {
    // Will lock nothing by default
    return await this.db.transact(f, inos.map(this.getLock.bind(this)));
  }

  protected getLock(ino: INodeIndex): MutexInterface {
    let lock = this.locks.get(ino);
    if (lock != null) return lock;
    lock = new Mutex();
    this.locks.set(ino, lock);
    return lock;
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async fileCreate(
    tran: DBTransaction,
    ino: INodeIndex,
    params: FileParams,
    blkSize: number,
    data?: Buffer,
  ): Promise<void> {
    const statDomain = [...this.statsDomain, ino.toString()];
    const mode = constants.S_IFREG | ((params.mode ?? 0) & ~constants.S_IFMT);
    await this.iNodeCreate(tran, 'File', {
      ...params,
      ino,
      mode,
    });
    await this.statSetProp(tran, ino, 'blksize', blkSize);
    if (data) {
      await this.fileSetBlocks(tran, ino, data, blkSize);
      await tran.put(statDomain, 'size', data.length);
      await tran.put(statDomain, 'blocks', Math.ceil(data.length / blkSize));
    }
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async dirCreate(
    tran: DBTransaction,
    ino: INodeIndex,
    params: DirectoryParams,
    parent?: INodeIndex,
  ): Promise<void> {
    const mode = constants.S_IFDIR | ((params.mode ?? 0) & ~constants.S_IFMT);
    const dirDomain = [...this.dirsDomain, ino.toString()];
    let nlink: number;
    if (parent == null) {
      // Root can never be garbage collected
      nlink = 2;
      parent = ino;
      if ((await this.dirGetRoot(tran)) != null) {
        throw new inodesErrors.ErrorINodesDuplicateRoot();
      }
      await this.dirSetRoot(tran, ino);
    } else {
      if ((await this.get(tran, parent)) == null) {
        throw new inodesErrors.ErrorINodesParentMissing();
      }
      nlink = 1;
    }
    await this.iNodeCreate(tran, 'Directory', {
      ...params,
      ino,
      mode,
      nlink,
    });
    if (nlink === 1) {
      await this.link(tran, parent!);
    }
    await tran.put(dirDomain, '.', ino);
    await tran.put(dirDomain, '..', parent);
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async symlinkCreate(
    tran: DBTransaction,
    ino: INodeIndex,
    params: SymlinkParams,
    link: string,
  ): Promise<void> {
    const mode = constants.S_IFLNK | ((params.mode ?? 0) & ~constants.S_IFMT);
    await this.iNodeCreate(tran, 'Symlink', {
      ...params,
      ino,
      mode,
    });
    await tran.put(this.linkDomain, inodesUtils.iNodeId(ino), link);
  }

  protected async iNodeCreate(
    tran: DBTransaction,
    type: INodeType,
    params: INodeParams,
  ): Promise<void> {
    const statDomain = [...this.statsDomain, params.ino.toString()];
    params.dev = params.dev ?? 0;
    params.nlink = params.nlink ?? 0;
    params.uid = params.uid ?? permissions.DEFAULT_ROOT_UID;
    params.gid = params.gid ?? permissions.DEFAULT_ROOT_GID;
    params.rdev = params.rdev ?? 0;
    params.size = params.size ?? 0;
    params.blksize = params.blksize ?? 0;
    params.blocks = params.blocks ?? 0;
    const now = new Date();
    params.atime = params.atime ?? now;
    params.mtime = params.mtime ?? now;
    params.ctime = params.ctime ?? now;
    params.birthtime = params.birthtime ?? now;
    await tran.put(
      this.iNodesDomain,
      inodesUtils.iNodeId(params.ino as INodeIndex),
      type,
    );
    await tran.put(statDomain, 'ino', params.ino);
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
          await tran.put(statDomain, key, value);
          break;
        case 'atime':
        case 'mtime':
        case 'ctime':
        case 'birthtime':
          await tran.put(statDomain, key, (value as Date).getTime());
          break;
      }
    }
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async fileDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    return this._fileDestroy(tran, ino);
  }

  protected async _fileDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    const dataDomain = [...this.dataDomain, ino.toString()];
    const dataDb = await this.db.level(ino.toString(), this.dataDb);
    for await (const k of dataDb.createKeyStream()) {
      await tran.del(dataDomain, k);
    }
    await this.iNodeDestroy(tran, ino);
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async dirDestroy(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    return this._dirDestroy(tran, ino);
  }

  protected async _dirDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    const dirDomain = [...this.dirsDomain, ino.toString()];
    const dirDb = await this.db.level(ino.toString(), this.dirsDb);
    const parent = (await tran.get<INodeIndex>(dirDomain, '..'))!;
    if (parent !== ino) {
      await this._unlink(tran, parent);
    } else {
      await this.dirUnsetRoot(tran);
    }
    for await (const k of dirDb.createKeyStream()) {
      await tran.del(dirDomain, k);
    }
    await this.iNodeDestroy(tran, ino);
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async symlinkDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    return this._symlinkDestroy(tran, ino);
  }

  protected async _symlinkDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    await tran.del(this.linkDomain, inodesUtils.iNodeId(ino));
    await this.iNodeDestroy(tran, ino);
  }

  protected async iNodeDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    const statDomain = [...this.statsDomain, ino.toString()];
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
      'birthtime',
    ];
    for (const k of keys) {
      await tran.del(statDomain, k);
    }
    await tran.del(this.iNodesDomain, inodesUtils.iNodeId(ino));
    await tran.del(this.gcDomain, inodesUtils.iNodeId(ino));
  }

  /**
   * Gets the INodeData
   * Use this to test if an ino number exists
   * You can use the returned ino for subsequent operations
   */
  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async get(
    tran: DBTransaction,
    ino: number,
  ): Promise<INodeData | undefined> {
    const type = await tran.get<INodeType>(
      this.iNodesDomain,
      inodesUtils.iNodeId(ino as INodeIndex),
    );
    if (type == null) {
      return;
    }
    const gc = await tran.get<null>(
      this.gcDomain,
      inodesUtils.iNodeId(ino as INodeIndex),
    );
    return {
      ino: ino as INodeIndex,
      type,
      gc: gc !== undefined,
    };
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async link(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    const nlink = await this.statGetProp(tran, ino, 'nlink');
    await this.statSetProp(tran, ino, 'nlink', nlink + 1);
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async unlink(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    return this._unlink(tran, ino);
  }

  protected async _unlink(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    const nlink = await this._statGetProp(tran, ino, 'nlink');
    await this._statSetProp(tran, ino, 'nlink', Math.max(nlink - 1, 0));
    await this.gc(tran, ino);
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public ref(ino: INodeIndex) {
    const refCount = this.refs.get(ino) ?? 0;
    this.refs.set(ino, refCount + 1);
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async unref(tran: DBTransaction, ino: INodeIndex) {
    const refCount = this.refs.get(ino);
    if (refCount == null) {
      return;
    }
    this.refs.set(ino, Math.max(refCount - 1, 0));
    await this.gc(tran, ino);
  }

  protected async gc(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    const refs = this.refs.get(ino) ?? 0;
    const nlink = await this._statGetProp(tran, ino, 'nlink');
    const type = (await tran.get<INodeType>(
      this.iNodesDomain,
      inodesUtils.iNodeId(ino),
    ))!;
    // The root directory will never be deleted
    if (nlink === 0 || (nlink === 1 && type === 'Directory')) {
      if (refs === 0) {
        // Delete the on-disk and in-memory state
        switch (type) {
          case 'File':
            await this._fileDestroy(tran, ino);
            break;
          case 'Directory':
            await this._dirDestroy(tran, ino);
            break;
          case 'Symlink':
            await this._symlinkDestroy(tran, ino);
            break;
        }
        tran.queueSuccess(() => {
          this.refs.delete(ino);
          this.locks.delete(ino);
          this.inoDeallocate(ino);
        });
      } else {
        // Schedule for deletion
        // when scheduled for deletion
        // it is not allowed for mutation of the directory to occur
        await tran.put(this.gcDomain, inodesUtils.iNodeId(ino), null);
      }
    }
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async statGet(tran: DBTransaction, ino: INodeIndex): Promise<Stat> {
    const statDomain = [...this.statsDomain, ino.toString()];
    const props: Array<any> = await Promise.all([
      tran.get<number>(statDomain, 'dev'),
      tran.get<number>(statDomain, 'mode'),
      tran.get<number>(statDomain, 'nlink'),
      tran.get<number>(statDomain, 'uid'),
      tran.get<number>(statDomain, 'gid'),
      tran.get<number>(statDomain, 'rdev'),
      tran.get<number>(statDomain, 'size'),
      tran.get<number>(statDomain, 'blksize'),
      tran.get<number>(statDomain, 'blocks'),
      tran.get<number>(statDomain, 'atime'),
      tran.get<number>(statDomain, 'mtime'),
      tran.get<number>(statDomain, 'ctime'),
      tran.get<number>(statDomain, 'birthtime'),
    ]);
    const [
      dev,
      mode,
      nlink,
      uid,
      gid,
      rdev,
      size,
      blksize,
      blocks,
      atime,
      mtime,
      ctime,
      birthtime,
    ] = props;
    return new Stat({
      dev,
      ino,
      mode,
      nlink,
      uid,
      gid,
      rdev,
      size,
      blksize,
      blocks,
      atime: new Date(atime),
      mtime: new Date(mtime),
      ctime: new Date(ctime),
      birthtime: new Date(birthtime),
    });
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async statGetProp<Key extends keyof StatProps>(
    tran: DBTransaction,
    ino: INodeIndex,
    key: Key,
  ): Promise<StatProps[Key]> {
    return this._statGetProp(tran, ino, key);
  }

  protected async _statGetProp<Key extends keyof StatProps>(
    tran: DBTransaction,
    ino: INodeIndex,
    key: Key,
  ): Promise<StatProps[Key]> {
    const statDomain = [...this.statsDomain, ino.toString()];
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
        value = (await tran.get<number>(statDomain, key))!;
        break;
      case 'atime':
      case 'mtime':
      case 'ctime':
      case 'birthtime':
        value = new Date((await tran.get<number>(statDomain, key))!);
        break;
    }
    return value;
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async statSetProp<Key extends keyof StatProps>(
    tran: DBTransaction,
    ino: INodeIndex,
    key: Key,
    value: StatProps[Key],
  ): Promise<void> {
    return this._statSetProp(tran, ino, key, value);
  }

  protected async _statSetProp<Key extends keyof StatProps>(
    tran: DBTransaction,
    ino: INodeIndex,
    key: Key,
    value: StatProps[Key],
  ): Promise<void> {
    const statDomain = [...this.statsDomain, ino.toString()];
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
        await tran.put(statDomain, key, value);
        break;
      case 'atime':
      case 'mtime':
      case 'ctime':
      case 'birthtime':
        await tran.put(statDomain, key, (value as Date).getTime());
        break;
    }
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async statUnsetProp<Key extends keyof StatProps>(
    tran: DBTransaction,
    ino: INodeIndex,
    key: Key,
  ): Promise<void> {
    const statDomain = [...this.statsDomain, ino.toString()];
    await tran.del(statDomain, key);
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async dirGetRoot(
    tran: DBTransaction,
  ): Promise<INodeIndex | undefined> {
    return tran.get<INodeIndex>(this.mgrDomain, 'root');
  }

  protected async dirSetRoot(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    await tran.put(this.mgrDomain, 'root', ino);
  }

  protected async dirUnsetRoot(tran: DBTransaction): Promise<void> {
    await tran.del(this.mgrDomain, 'root');
  }

  /**
   * Iterators are not part of our snapshot yet
   */
  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async *dirGet(
    tran: DBTransaction,
    ino: INodeIndex,
  ): AsyncGenerator<[string, INodeIndex]> {
    const dirDb = await this.db.level(ino.toString(), this.dirsDb);
    for await (const o of dirDb.createReadStream()) {
      const name = (o as any).key.toString('utf-8') as string;
      const value = await this.db.deserializeDecrypt<INodeIndex>(
        (o as any).value,
        false,
      );
      yield [name, value];
    }
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async dirGetEntry(
    tran: DBTransaction,
    ino: INodeIndex,
    name: string,
  ): Promise<INodeIndex | undefined> {
    const dirDomain = [...this.dirsDomain, ino.toString()];
    return tran.get<INodeIndex>(dirDomain, name);
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async dirSetEntry(
    tran: DBTransaction,
    ino: INodeIndex,
    name: string,
    value: INodeIndex,
  ): Promise<void> {
    const dirDomain = [...this.dirsDomain, ino.toString()];
    if ((await this.get(tran, value)) == null) {
      throw new inodesErrors.ErrorINodesIndexMissing();
    }
    const existingValue = await tran.get<INodeIndex>(dirDomain, name);
    if (existingValue === value) {
      return;
    }
    const now = new Date();
    await tran.put(dirDomain, name, value);
    await this.statSetProp(tran, ino, 'mtime', now);
    await this.statSetProp(tran, ino, 'ctime', now);
    await this.link(tran, value);
    if (existingValue != null) {
      await this.unlink(tran, existingValue);
    }
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async dirUnsetEntry(
    tran: DBTransaction,
    ino: INodeIndex,
    name: string,
  ): Promise<void> {
    const dirDomain = [...this.dirsDomain, ino.toString()];
    const now = new Date();
    const existingValue = await tran.get<INodeIndex>(dirDomain, name);
    if (existingValue == null) {
      return;
    }
    await tran.del(dirDomain, name);
    await this.statSetProp(tran, ino, 'mtime', now);
    await this.statSetProp(tran, ino, 'ctime', now);
    await this.unlink(tran, existingValue);
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async dirResetEntry(
    tran: DBTransaction,
    ino: INodeIndex,
    nameOld: string,
    nameNew: string,
  ): Promise<void> {
    const dirDomain = [...this.dirsDomain, ino.toString()];
    const inoOld = await tran.get<INodeIndex>(dirDomain, nameOld);
    if (inoOld == null) {
      throw new inodesErrors.ErrorINodesInvalidName();
    }
    const now = new Date();
    await this.statSetProp(tran, ino, 'ctime', now);
    await this.statSetProp(tran, ino, 'mtime', now);
    await this.statSetProp(tran, inoOld, 'ctime', now);
    const inoReplace = await this.dirGetEntry(tran, ino, nameNew);
    if (inoReplace) {
      await this.statSetProp(tran, inoReplace, 'ctime', now);
    }
    // The order must be set then unset
    // it cannot work if unset then set, the old inode may get garbage collected
    await this.dirSetEntry(tran, ino, nameNew, inoOld);
    await this.dirUnsetEntry(tran, ino, nameOld);
  }

  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async symlinkGetLink(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<string> {
    const link = await tran.get<string>(
      this.linkDomain,
      inodesUtils.iNodeId(ino),
    );
    return link!;
  }

  /**
   * Modified and Change Time are both updated here as this is
   * exposed to the EFS functions to be used
   */
  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async fileClearData(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    // To set the data we must first clear all existing data, which is
    // how VFS handles it
    const dataDb = await this.db.level(ino.toString(), this.dataDb);
    const dataDomain = [...this.dataDomain, ino.toString()];
    for await (const key of dataDb.createKeyStream()) {
      await tran.del(dataDomain, key);
    }
  }

  /**
   * Iterators are not part of our snapshot yet
   * Access time not updated here, handled at higher level as this is only
   * accessed by fds and and other INodeMgr functions
   */
  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async *fileGetBlocks(
    tran: DBTransaction,
    ino: INodeIndex,
    blockSize: number,
    startIdx = 0,
    endIdx?: number,
  ): AsyncGenerator<Buffer> {
    const dataDb = await this.db.level(ino.toString(), this.dataDb);
    const options = endIdx
      ? {
          gte: inodesUtils.bufferId(startIdx),
          lt: inodesUtils.bufferId(endIdx),
        }
      : { gte: inodesUtils.bufferId(startIdx) };
    let blockCount = startIdx;
    for await (const data of dataDb.createReadStream(options)) {
      // This is to account for the case where a some blocks are missing in a database
      // i.e. blocks 0 -> 3 have data and a write operation was performed on blocks 7 -> 8
      while (inodesUtils.unbufferId((data as any).key) !== blockCount) {
        yield Buffer.alloc(blockSize);
      }
      const plainTextData = await this.db.deserializeDecrypt(
        (data as any).value as Buffer,
        true,
      );
      yield plainTextData;
      blockCount++;
    }
  }

  /**
   * Iterators are not part of our snapshot yet
   * Access time not updated here, handled at higher level as this is only
   * accessed by fds and and other INodeMgr functions
   */
  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async fileGetLastBlock(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<[number, Buffer]> {
    const dataDb = await this.db.level(ino.toString(), this.dataDb);
    const options = { limit: 1, reverse: true };
    let key, value;
    for await (const data of dataDb.createReadStream(options)) {
      key = inodesUtils.unbufferId((data as any).key);
      value = await this.db.deserializeDecrypt(
        (data as any).value as Buffer,
        true,
      );
    }
    if (value == null || key == null) {
      return [0, Buffer.alloc(0)];
    }
    return [key, value];
  }

  /**
   * Access time not updated here, handled at higher level as this is only
   * accessed by fds and and other INodeMgr functions
   */
  protected async fileGetBlock(
    tran: DBTransaction,
    ino: INodeIndex,
    idx: number,
  ): Promise<Buffer | undefined> {
    const dataDomain = [...this.dataDomain, ino.toString()];
    const key = inodesUtils.bufferId(idx);
    const buffer = await tran.get(dataDomain, key, true);
    if (!buffer) {
      return undefined;
    }
    return buffer;
  }

  /**
   * Modified and Change time not updated here, handled at higher level as this
   * is only accessed by fds and and other INodeMgr functions
   */
  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async fileSetBlocks(
    tran: DBTransaction,
    ino: INodeIndex,
    data: Buffer,
    blockSize: number,
    startIdx = 0,
  ): Promise<void> {
    const bufferSegments = utils.segmentBuffer(blockSize, data);
    let blockIdx = startIdx;
    for (const dataSegment of bufferSegments) {
      await this.fileWriteBlock(tran, ino, dataSegment, blockIdx);
      blockIdx++;
    }
  }

  /**
   * Modified and Change time not updated here, handled at higher level as this
   * is only accessed by fds and other INodeMgr functions
   */
  @ready(new inodesErrors.ErrorINodesNotRunning())
  public async fileWriteBlock(
    tran: DBTransaction,
    ino: INodeIndex,
    data: Buffer,
    idx: number,
    offset = 0,
  ): Promise<number> {
    const dataDomain = [...this.dataDomain, ino.toString()];
    let block = await this.fileGetBlock(tran, ino, idx);
    const key = inodesUtils.bufferId(idx);
    let bytesWritten;
    if (!block) {
      await tran.put(dataDomain, key, data, true);
      bytesWritten = data.length;
    } else {
      if (offset >= block.length) {
        // In this case we are not overwriting the data but appending
        const newBlock = Buffer.alloc(offset + data.length);
        block.copy(newBlock);
        bytesWritten = data.copy(newBlock, offset);
        await tran.put(dataDomain, key, newBlock, true);
      } else {
        // In this case we are overwriting
        if (offset + data.length > block.length) {
          block = Buffer.concat([
            block,
            Buffer.alloc(offset + data.length - block.length),
          ]);
        }
        bytesWritten = data.copy(block, offset);
        await tran.put(dataDomain, key, block, true);
      }
    }
    return bytesWritten;
  }
}

export default INodeManager;
