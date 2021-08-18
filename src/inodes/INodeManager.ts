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
import Counter from 'resource-counter';
import * as inodesUtils from './utils';
import * as inodesErrors from './errors';
import Stat from '../Stat';
import * as utils from '../utils';

type INodeParams = Partial<StatProps> & Pick<StatProps, 'ino' | 'mode'>;
type FileParams = Partial<Omit<INodeParams, 'ino'>>;
type DirectoryParams = Partial<Omit<INodeParams, 'ino'>>;
type SymlinkParams = Partial<Omit<INodeParams, 'ino'>>;
type CharDevParams = Partial<Omit<INodeParams, 'ino'>>;

class INodeManager {

  public static async createINodeManager(
    {
      db,
      devMgr,
      counter = new Counter(1),
      logger = new Logger(INodeManager.name),
    }: {
      db: DB;
      devMgr: DeviceManager;
      counter?: Counter;
      logger?: Logger;
    }
  ): Promise<INodeManager> {
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
    const gcDb = await db.level(iNodesDomain[1], mgrDb);
    for await (const k of iNodesDb.createKeyStream()) {
      counter.allocate(
        inodesUtils.uniNodeId(k as INodeId)
      );
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
      gcDb
    });
    // clean up any dangling inodes
    for await (const k of gcDb.createKeyStream()) {
      // no need for locking as this is done at the beginning
      await db.transaction(async (tran) => {
        await iNodeMgr.destroy(
          tran,
          inodesUtils.uniNodeId(k as INodeId)
        );
      }, []);
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
  protected mgrDb: DBLevel;
  protected iNodesDb: DBLevel;
  protected statsDb: DBLevel;
  protected dataDb: DBLevel;
  protected dirsDb: DBLevel;
  protected linkDb: DBLevel;
  protected gcDb: DBLevel;
  protected refs: Map<INodeIndex, number> = new Map;
  protected locks: Map<INodeIndex, MutexInterface> = new Map;

  protected constructor (
    {
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
      gcDb
    }: {
      db: DB,
      devMgr: DeviceManager,
      counter: number;
      logger: Logger,
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
    }
  ) {
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

  public async transaction<T>(
    f: (t: DBTransaction) => Promise<T>,
    inos: Array<INodeIndex> = []
  ) {
    // will lock nothing by default
    return await this.db.transaction(
      f,
      inos.map(this.getLock.bind(this))
    );
  }

  protected getLock(ino: INodeIndex): MutexInterface {
    let lock = this.locks.get(ino);
    if (lock != null) return lock;
    lock = new Mutex;
    this.locks.set(ino, lock);
    return lock;
  }

  public async fileCreate(
    tran: DBTransaction,
    ino: INodeIndex,
    params: FileParams,
    data?: Buffer,
  ): Promise<void> {
    const mode = vfs.constants.S_IFREG | ((params.mode ?? 0) & (~vfs.constants.S_IFMT));
    await this.iNodeCreate(tran, 'File', {
      ...params,
      ino,
      mode
    });
    // TODO:
    // add in buffer creation (from data)
    // calculate params.blockSize and params.blocks
    // based on the actual data
  }

  public async dirCreate(
    tran: DBTransaction,
    ino: INodeIndex,
    params: DirectoryParams,
    parent?: INodeIndex,
  ): Promise<void> {
    const mode = vfs.constants.S_IFDIR | ((params.mode ?? 0) & (~vfs.constants.S_IFMT));
    const dirDomain = [...this.dirsDomain, ino.toString()];
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
    await tran.put(this.linkDomain, inodesUtils.iNodeId(ino), link);
  }

  public async charDevCreate(
    tran: DBTransaction,
    ino: INodeIndex,
    params: CharDevParams,
  ): Promise<void> {
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
  }

  protected async iNodeCreate(
    tran: DBTransaction,
    type: INodeType,
    params: INodeParams,
  ): Promise<void> {
    const statDomain = [...this.statsDomain, params.ino.toString()];
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
    await tran.put(this.iNodesDomain, inodesUtils.iNodeId(params.ino), type);
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
    ino: INodeIndex
  ): Promise<void> {
    const dataDomain = [...this.dataDomain, ino.toString()];
    const dataDb = await this.db.level(ino.toString(), this.dataDb);
    for await (const k of dataDb.createKeyStream()) {
      await tran.del(dataDomain, k);
    }
    await this.iNodeDestroy(tran, ino);
  }

  public async dirDestroy(
    tran: DBTransaction,
    ino: INodeIndex,
  ): Promise<void> {
    const dirDomain = [...this.dirsDomain, ino.toString()];
    const dirDb = await this.db.level(ino.toString(), this.dirsDb);
    const parent = (await tran.get<number>(dirDomain, '..'))!;
    if (parent !== ino) {
      await this.unlink(tran, ino);
    }
    for await (const k of dirDb.createKeyStream()) {
      await tran.del(dirDomain, k);
    }
    await this.iNodeDestroy(tran, ino);
  }

  public async symlinkDestroy(
    tran: DBTransaction,
    ino: INodeIndex
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
      'birthtime'
    ];
    for (const k of keys) {
      await tran.del(statDomain, k);
    }
    await tran.del(this.iNodesDomain, inodesUtils.iNodeId(ino));
    await tran.del(this.gcDomain, inodesUtils.iNodeId(ino));
  }

  public async getType(tran: DBTransaction, ino: INodeIndex): Promise<INodeType> {
    const type = await tran.get<INodeType>(
      this.iNodesDomain,
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
    await this.statSetProp(tran, ino, 'nlink', Math.max(nlink - 1, 0));
    await this.gc(tran, ino);
  }

  public async ref(
    tran: DBTransaction,
    ino: INodeIndex
  ) {
    const refCount = this.refs.get(ino) ?? 0;
    this.refs.set(ino, refCount + 1);
  }

  public async unref(
    tran: DBTransaction,
    ino: INodeIndex
  ) {
    const refCount = this.refs.get(ino);
    if (refCount == null) {
      return;
    }
    this.refs.set(ino, Math.max(refCount - 1, 0));
    await this.gc(tran, ino);
  }

  public async gc(tran: DBTransaction, ino: INodeIndex): Promise<void> {
    const refs = this.refs.get(ino) ?? 0;
    const nlink = await this.statGetProp(tran, ino, 'nlink');

    // this tries to acquire a type
    // just in case for nlink...
    // since nlink of 1 for directory is sufficient
    const type = (await tran.get<INodeType>(
      this.iNodesDomain,
      inodesUtils.iNodeId(ino),
    ))!;

    if (nlink === 0 || nlink === 1 && type === 'Directory') {
      if (refs === 0) {
        // delete now
        await this.destroy(tran, ino);
      } else {
        // schedule for deletion
        // when it is scheduled for deletion
        // it is not allowed for mutation of the directory to occur
        // that's something that should be tested
        await tran.put(
          this.gcDomain,
          inodesUtils.iNodeId(ino),
          null
        );
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
        value = (await tran.get<number>(statDomain, key))!
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
    value: StatProps[Key]
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

  /**
   * Iterators are not part of our snapshot yet
   */
  public async *dirGet(
    tran: DBTransaction,
    ino: INodeIndex
  ): AsyncGenerator<[string, INodeIndex]>{
    const dirDb = await this.db.level(ino.toString(), this.dirsDb);
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
    const dirDomain = [...this.dirsDomain, ino.toString()];
    return tran.get<number>(dirDomain, name);
  }

  public async dirSetEntry(
    tran: DBTransaction,
    ino: INodeIndex,
    name: string,
    value: INodeIndex
  ): Promise<void> {
    const dirDomain = [...this.dirsDomain, ino.toString()];
    const existingValue = await tran.get<INodeIndex>(dirDomain, name);
    if (existingValue === value) {
      return;
    }
    const now = new Date;
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
    const now = new Date;
    const existingValue = await tran.get<INodeIndex>(dirDomain, name);
    if (existingValue == null) {
      return;
    }
    await tran.del(dirDomain, name);
    await this.statSetProp(tran, ino, 'mtime', now);
    await this.statSetProp(tran, ino, 'ctime', now);
    await this.unlink(tran, existingValue);
  }

  public async symlinkGetLink(
    tran: DBTransaction,
    ino: INodeIndex
  ): Promise<string> {
    const link = await tran.get<string>(
      this.linkDomain,
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

  /**
   * Iterators are not part of our snapshot yet
   */
   public async *fileGetBlocks(
    tran: DBTransaction,
    ino: INodeIndex,
    startIdx = 0,
    endIdx?: number,
  ): AsyncGenerator<string>{
    const dataDb = await this.db.level(ino.toString(), this.dataDb);
    const options = endIdx ? { gt: inodesUtils.bufferId(startIdx), lte: inodesUtils.bufferId(endIdx) } : { gt: inodesUtils.bufferId(startIdx) }
    for await (const data of dataDb.createValueStream(options)) {
      const plainTextData = await this.db.deserializeDecrypt<string>((data as any) as Buffer, false);
      yield plainTextData;
    }
  }

  public async fileSetData(
    tran: DBTransaction,
    ino: INodeIndex,
    data: Buffer,
    blockSize: number
  ): Promise<void> {
    const dataDomain = [...this.dataDomain, ino.toString()];
    const bufferSegments = utils.segmentBuffer(blockSize, data);
    let key, value;
    let blockIdx = 1;
    for (const dataSegment of bufferSegments) {
      key = inodesUtils.bufferId(blockIdx);
      value = dataSegment.toString();
      await tran.put(dataDomain, key, value);
      blockIdx++;
    }
  }

}

export default INodeManager;
