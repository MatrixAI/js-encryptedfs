import type { MutexInterface } from 'async-mutex';
import type { DeviceManager } from '..';
import type { INodeIndex, INodeId, INodeType, INodeData } from './types';
import type { DB } from '../db';
import type { StatProps } from '../Stat';
import type { DBDomain, DBLevel, DBTransaction } from '../db/types';

import { DeviceInterface, CharacterDev } from 'virtualfs';
import Logger from '@matrixai/logger';
import { Mutex } from 'async-mutex';
import Counter from 'resource-counter';

import Stat from '../Stat';
import { constants, permissions } from '../constants';
import * as inodesUtils from './utils';
import * as inodesErrors from './errors';
import * as utils from '../utils';

type INodeParams = Partial<StatProps> & Pick<StatProps, 'ino' | 'mode'>;
type FileParams = Partial<Omit<INodeParams, 'ino'>>;
type DirectoryParams = Partial<Omit<INodeParams, 'ino'>>;
type SymlinkParams = Partial<Omit<INodeParams, 'ino'>>;
type CharDevParams = Partial<Omit<INodeParams, 'ino'>>;

class INodeManager {
  public static async createINodeManager({
    db,
    devMgr,
    counter = new Counter(1),
    logger = new Logger(INodeManager.name),
  }: {
    db: DB;
    devMgr: DeviceManager;
    counter?: Counter;
    logger?: Logger;
  }): Promise<INodeManager> {
    const mgrDomain: DBDomain = [INodeManager.name];
    const iNodesDomain: DBDomain = [mgrDomain[0], 'inodes'];
    const statsDomain: DBDomain = [mgrDomain[0], 'stat'];
    const dataDomain: DBDomain = [mgrDomain[0], 'data'];
    const dirsDomain: DBDomain = [mgrDomain[0], 'dir'];
    const linkDomain: DBDomain = [mgrDomain[0], 'link'];
    const gcDomain: DBDomain = [mgrDomain[0], 'gc'];
    const mgrDb = await db.level(mgrDomain[0]);
    const iNodesDb = await db.level(iNodesDomain[1], mgrDb);
    const statsDb = await db.level(statsDomain[1], mgrDb);
    const dataDb = await db.level(dataDomain[1], mgrDb);
    const dirsDb = await db.level(dirsDomain[1], mgrDb);
    const linkDb = await db.level(linkDomain[1], mgrDb);
    const gcDb = await db.level(gcDomain[1], mgrDb);
    for await (const k of iNodesDb.createKeyStream()) {
      counter.allocate(inodesUtils.uniNodeId(k as INodeId));
    }
    const iNodeMgr = new INodeManager({
      db,
      devMgr,
      counter,
      logger,
      mgrDomain,
      mgrDb,
      iNodesDomain,
      iNodesDb,
      statsDomain,
      statsDb,
      dataDomain,
      dataDb,
      dirsDomain,
      dirsDb,
      linkDomain,
      linkDb,
      gcDomain,
      gcDb,
    });
    // Clean up any dangling inodes
    for await (const k of gcDb.createKeyStream()) {
      await db.transact(async (tran) => {
        await iNodeMgr.destroy(tran, inodesUtils.uniNodeId(k as INodeId));
      });
    }
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
  protected _devMgr: DeviceManager;
  protected counter: Counter;

  public mgrDb: DBLevel;
  public iNodesDb: DBLevel;
  public statsDb: DBLevel;
  public dataDb: DBLevel;
  public dirsDb: DBLevel;
  public linkDb: DBLevel;
  public gcDb: DBLevel;
  protected refs: Map<INodeIndex, number> = new Map();
  protected locks: Map<INodeIndex, MutexInterface> = new Map();

  protected constructor({
    db,
    devMgr,
    counter,
    logger,
    mgrDomain,
    mgrDb,
    iNodesDomain,
    iNodesDb,
    statsDomain,
    statsDb,
    dataDomain,
    dataDb,
    dirsDomain,
    dirsDb,
    linkDomain,
    linkDb,
    gcDomain,
    gcDb,
  }: {
    db: DB;
    devMgr: DeviceManager;
    counter: number;
    logger: Logger;
    mgrDomain: DBDomain;
    mgrDb: DBLevel;
    iNodesDomain: DBDomain;
    iNodesDb: DBLevel;
    statsDomain: DBDomain;
    statsDb: DBLevel;
    dataDomain: DBDomain;
    dataDb: DBLevel;
    dirsDomain: DBDomain;
    dirsDb: DBLevel;
    linkDomain: DBDomain;
    linkDb: DBLevel;
    gcDomain: DBDomain;
    gcDb: DBLevel;
  }) {
    this.logger = logger;
    this._db = db;
    this._devMgr = devMgr;
    this.counter = counter;
    this.mgrDomain = mgrDomain;
    this.mgrDb = mgrDb;
    this.iNodesDomain = iNodesDomain;
    this.iNodesDb = iNodesDb;
    this.statsDomain = statsDomain;
    this.statsDb = statsDb;
    this.dataDomain = dataDomain;
    this.dataDb = dataDb;
    this.dirsDomain = dirsDomain;
    this.dirsDb = dirsDb;
    this.linkDomain = linkDomain;
    this.linkDb = linkDb;
    this.gcDomain = gcDomain;
    this.gcDb = gcDb;
  }

  get db(): DB {
    return this._db;
  }

  get devMgr(): DeviceManager {
    return this._devMgr;
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
      // Root cannot never be garbage collected
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

  public async charDevCreate(
    tran: DBTransaction,
    ino: INodeIndex,
    params: CharDevParams,
  ): Promise<void> {
    const mode = constants.S_IFCHR | ((params.mode ?? 0) & ~constants.S_IFMT);
    await this.iNodeCreate(tran, 'CharacterDev', {
      ...params,
      ino,
      mode,
    });
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

  public async destroy(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    const type = await tran.get<INodeType>(
      this.iNodesDomain,
      inodesUtils.iNodeId(ino),
    );
    if (type == null) {
      return;
    }
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
    tran.queueSuccess(() => {
      this.refs.delete(ino);
      this.locks.delete(ino);
      this.inoDeallocate(ino);
    });
  }

  public async fileDestroy(
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

  public async dirDestroy(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    const dirDomain = [...this.dirsDomain, ino.toString()];
    const dirDb = await this.db.level(ino.toString(), this.dirsDb);
    const parent = (await tran.get<INodeIndex>(dirDomain, '..'))!;
    if (parent !== ino) {
      await this.unlink(tran, parent);
    } else {
      await this.dirUnsetRoot(tran);
    }
    for await (const k of dirDb.createKeyStream()) {
      await tran.del(dirDomain, k);
    }
    await this.iNodeDestroy(tran, ino);
  }

  public async symlinkDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    await tran.del(this.linkDomain, inodesUtils.iNodeId(ino));
    await this.iNodeDestroy(tran, ino);
  }

  public async charDevDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
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

  public async link(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    const nlink = await this.statGetProp(tran, ino, 'nlink');
    await this.statSetProp(tran, ino, 'nlink', nlink + 1);
  }

  public async unlink(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    const nlink = await this.statGetProp(tran, ino, 'nlink');
    await this.statSetProp(tran, ino, 'nlink', Math.max(nlink - 1, 0));
    await this.gc(tran, ino);
  }

  public ref(ino: INodeIndex) {
    const refCount = this.refs.get(ino) ?? 0;
    this.refs.set(ino, refCount + 1);
  }

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
    const nlink = await this.statGetProp(tran, ino, 'nlink');
    const type = (await tran.get<INodeType>(
      this.iNodesDomain,
      inodesUtils.iNodeId(ino),
    ))!;
    // The root directory will never be deleted
    if (nlink === 0 || (nlink === 1 && type === 'Directory')) {
      if (refs === 0) {
        await this.destroy(tran, ino);
      } else {
        // Schedule for deletion
        // when scheduled for deletion
        // it is not allowed for mutation of the directory to occur
        await tran.put(this.gcDomain, inodesUtils.iNodeId(ino), null);
      }
    }
  }

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

  public async statGetProp<Key extends keyof StatProps>(
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

  public async statSetProp<Key extends keyof StatProps>(
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

  public async statUnsetProp<Key extends keyof StatProps>(
    tran: DBTransaction,
    ino: INodeIndex,
    key: Key,
  ): Promise<void> {
    const statDomain = [...this.statsDomain, ino.toString()];
    await tran.del(statDomain, key);
  }

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

  public async dirGetEntry(
    tran: DBTransaction,
    ino: INodeIndex,
    name: string,
  ): Promise<INodeIndex | undefined> {
    const dirDomain = [...this.dirsDomain, ino.toString()];
    return tran.get<INodeIndex>(dirDomain, name);
  }

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

  public async charDevGetFileDesOps(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<Readonly<DeviceInterface<CharacterDev>> | undefined> {
    const rdev = await this.statGetProp(tran, ino, 'rdev');
    const [major, minor] = utils.unmkDev(rdev);
    return this.devMgr.getChr(major, minor);
  }

  /**
   * Modified and Change Time are both updated here as this is
   * exposed to the EFS functions to be used
   */
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
      while (inodesUtils.unbufferId((data as any).key) != blockCount) {
        yield Buffer.alloc(blockSize);
      }
      const plainTextData = await this.db.deserializeDecrypt<string>(
        (data as any).value as Buffer,
        false,
      );
      yield Buffer.from(plainTextData);
      blockCount++;
    }
  }

  /**
   * Iterators are not part of our snapshot yet
   * Access time not updated here, handled at higher level as this is only
   * accessed by fds and and other INodeMgr functions
   */
  public async fileGetLastBlock(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<[number, Buffer]> {
    const dataDb = await this.db.level(ino.toString(), this.dataDb);
    const options = { limit: 1, reverse: true };
    let key, value;
    for await (const data of dataDb.createReadStream(options)) {
      key = inodesUtils.unbufferId((data as any).key);
      value = await this.db.deserializeDecrypt<string>(
        (data as any).value as Buffer,
        false,
      );
    }
    if (value == undefined || key == undefined) {
      return [0, Buffer.alloc(0)];
    }
    return [key, Buffer.from(value)];
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
    const buffer = await tran.get<Buffer>(dataDomain, key);
    if (!buffer) {
      return undefined;
    }
    return Buffer.from(buffer);
  }

  /**
   * Modified and Change time not updated here, handled at higher level as this
   * is only accessed by fds and and other INodeMgr functions
   */
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
      const value = data.toString();
      await tran.put(dataDomain, key, value);
      bytesWritten = data.length;
    } else {
      if (offset >= block.length) {
        // In this case we are not overwriting the data but appending
        const newBlock = Buffer.alloc(offset + data.length);
        newBlock.write(block.toString());
        bytesWritten = newBlock.write(data.toString(), offset);
        const value = newBlock.toString();
        await tran.put(dataDomain, key, value);
      } else {
        // In this case we are overwriting
        if (offset + data.length > block.length) {
          block = Buffer.concat([
            block,
            Buffer.alloc(offset + data.length - block.length),
          ]);
        }
        bytesWritten = block.write(data.toString(), offset);
        const value = block.toString();
        await tran.put(dataDomain, key, value);
      }
    }
    return bytesWritten;
  }
}

export default INodeManager;
