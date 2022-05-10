import type { DB, DBTransaction, LevelPath } from '@matrixai/db';
import type { ResourceAcquire } from '@matrixai/resources';
import type {
  INodeIndex,
  INodeId,
  INodeType,
  INodeData,
  BufferId,
} from './types';
import type { Ref } from '../types';
import type { StatProps } from '../Stat';
import Logger from '@matrixai/logger';
import {
  CreateDestroyStartStop,
  ready,
} from '@matrixai/async-init/dist/CreateDestroyStartStop';
import { Lock, LockBox } from '@matrixai/async-locks';
import { withF, withG } from '@matrixai/resources';
import { utils as dbUtils } from '@matrixai/db';
import Counter from 'resource-counter';
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
  new inodesErrors.ErrorINodeManagerRunning(),
  new inodesErrors.ErrorINodeManagerDestroyed(),
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

  public readonly mgrDbPath: LevelPath = [this.constructor.name];
  public readonly iNodesDbPath: LevelPath = [this.constructor.name, 'inodes'];
  public readonly statsDbPath: LevelPath = [this.constructor.name, 'stats'];
  public readonly dataDbPath: LevelPath = [this.constructor.name, 'data'];
  public readonly dirsDbPath: LevelPath = [this.constructor.name, 'dir'];
  public readonly linkDbPath: LevelPath = [this.constructor.name, 'link'];
  public readonly gcDbPath: LevelPath = [this.constructor.name, 'gc'];

  protected logger: Logger;
  protected db: DB;
  protected iNodeCounter: Counter = new Counter(1);
  protected iNodeAllocations: Map<string, Ref<INodeIndex>> = new Map();
  protected refs: Map<INodeIndex, number> = new Map();
  protected locks: LockBox<Lock> = new LockBox();

  constructor({ db, logger }: { db: DB; logger: Logger }) {
    this.logger = logger;
    this.db = db;
  }

  public async start({ fresh = false }: { fresh?: boolean }): Promise<void> {
    this.logger.info(`Starting ${this.constructor.name}`);
    if (fresh) {
      await this.db.clear(this.mgrDbPath);
    }
    // Populate the inode counter with pre-existing inodes
    for await (const [k] of this.db.iterator(
      { values: false },
      this.iNodesDbPath,
    )) {
      this.iNodeCounter.allocate(inodesUtils.uniNodeId(k as INodeId));
    }
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
    this.iNodeCounter = new Counter(1);
    // Reset the references
    this.refs.clear();
    this.logger.info(`Stopped ${this.constructor.name}`);
  }

  public async destroy(): Promise<void> {
    this.logger.info(`Destroying ${this.constructor.name}`);
    await this.db.clear(this.mgrDbPath);
    this.logger.info(`Destroyed ${this.constructor.name}`);
  }

  /**
   * Delete iNodes that were scheduled for deletion
   * These iNodes could not be deleted because of an existing reference
   * This is used during `this.start` and `this.stop`, and thus does not use any locks
   * This must only be called when there are no active `this.refs` or `this.locks`
   */
  protected async gcAll(): Promise<void> {
    await withF([this.db.transaction()], async ([tran]) => {
      for await (const [k] of tran.iterator({ values: false }, this.gcDbPath)) {
        const ino = inodesUtils.uniNodeId(k as INodeId);
        // Snapshot doesn't need to be used because `this.gcAll` is only executed at `this.stop`
        const type = (await tran.get<INodeType>([
          ...this.iNodesDbPath,
          inodesUtils.iNodeId(ino),
        ]))!;
        // Delete the on-disk state
        switch (type) {
          case 'File':
            await this._fileDestroy(ino, tran);
            break;
          case 'Directory':
            await this._dirDestroy(ino, tran);
            break;
          case 'Symlink':
            await this._symlinkDestroy(ino, tran);
            break;
        }
        tran.queueSuccess(() => {
          this.refs.delete(ino);
          this.inoDeallocate(ino);
        });
      }
    });
  }

  public inoAllocate(): INodeIndex {
    return this.iNodeCounter.allocate();
  }

  public inoDeallocate(ino: INodeIndex): void {
    return this.iNodeCounter.deallocate(ino);
  }

  /**
   * INodeIndex allocation resource
   * This resource represents potentially INodeIndex being allocated
   * The navigated parameter tells us where the first hardlink for this INodeIndex will be set
   * If left to be undefined, it is assumed that you are allocating the root INodeIndex
   * Concurrent call with same navigated parameter will result in the same INodeIndex result
   * This is essential to enable mutual-exclusion
   */
  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public inoAllocation(
    navigated?: Readonly<{ dir: INodeIndex; name: string }>,
  ): ResourceAcquire<INodeIndex> {
    let key: string;
    if (navigated == null) {
      key = '';
    } else {
      key = navigated.dir + navigated.name;
    }
    return async () => {
      let inoRef = this.iNodeAllocations.get(key);
      if (inoRef != null) {
        inoRef.count++;
      } else {
        inoRef = {
          value: this.inoAllocate(),
          count: 1,
        };
        this.iNodeAllocations.set(key, inoRef);
      }
      return [
        async (e) => {
          // Only deallocate if there was an error while using inode allocation
          if (e != null) {
            this.iNodeCounter.deallocate(inoRef!.value);
          }
          // Remove the inode allocations entry if the count reaches 0
          if (--inoRef!.count <= 0) {
            this.iNodeAllocations.delete(key);
          }
        },
        inoRef.value,
      ];
    };
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public transaction(
    ...inos: Array<INodeIndex>
  ): ResourceAcquire<DBTransaction> {
    return async () => {
      const locksAcquire = this.locks.lock(
        ...inos.map<[INodeIndex, typeof Lock]>((ino) => [ino, Lock]),
      );
      const transactionAcquire = this.db.transaction();
      const [locksRelease] = await locksAcquire();
      let transactionRelease, tran;
      try {
        [transactionRelease, tran] = await transactionAcquire();
      } catch (e) {
        await locksRelease();
        throw e;
      }
      return [
        async () => {
          await transactionRelease();
          await locksRelease();
        },
        tran,
      ];
    };
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async withTransactionF<T>(
    ...params: [
      ...inos: Array<INodeIndex>,
      f: (tran: DBTransaction) => Promise<T>,
    ]
  ): Promise<T> {
    const f = params.pop() as (tran: DBTransaction) => Promise<T>;
    const lockRequests = (params as Array<INodeIndex>).map<
      [INodeIndex, typeof Lock]
    >((ino) => [ino, Lock]);
    return withF(
      [this.db.transaction(), this.locks.lock(...lockRequests)],
      ([tran]) => f(tran),
    );
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public withTransactionG<T, TReturn, TNext>(
    ...params: [
      ...inos: Array<INodeIndex>,
      g: (tran: DBTransaction) => AsyncGenerator<T, TReturn, TNext>,
    ]
  ): AsyncGenerator<T, TReturn, TNext> {
    const g = params.pop() as (
      tran: DBTransaction,
    ) => AsyncGenerator<T, TReturn, TNext>;
    const lockRequests = (params as Array<INodeIndex>).map<
      [INodeIndex, typeof Lock]
    >((ino) => [ino, Lock]);
    return withG(
      [this.db.transaction(), this.locks.lock(...lockRequests)],
      ([tran]) => g(tran),
    );
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async withNewINodeTransactionF<T>(
    ...params:
      | [
          ...inos: Array<INodeIndex>,
          f: (ino: INodeIndex, tran: DBTransaction) => Promise<T>,
        ]
      | [
          navigated: Readonly<{ dir: INodeIndex; name: string }>,
          ...inos: Array<INodeIndex>,
          f: (ino: INodeIndex, tran: DBTransaction) => Promise<T>,
        ]
  ): Promise<T> {
    const f = params.pop() as (
      ino: INodeIndex,
      tran: DBTransaction,
    ) => Promise<T>;
    let navigated: Readonly<{ dir: INodeIndex; name: string }> | undefined;
    if (typeof params[0] !== 'number') {
      navigated = params.shift() as Readonly<{ dir: INodeIndex; name: string }>;
    }
    const lockRequests = (params as Array<INodeIndex>).map<
      [INodeIndex, typeof Lock]
    >((ino) => [ino, Lock]);
    return withF(
      [
        this.inoAllocation(navigated),
        ([ino]: [INodeIndex]) =>
          this.locks.lock([ino, Lock], ...lockRequests)(),
        this.db.transaction(),
      ],
      ([ino, _, tran]) => f(ino, tran),
    );
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public withNewINodeTransactionG<T, TReturn, TNext>(
    ...params:
      | [
          ...inos: Array<INodeIndex>,
          g: (
            ino: INodeIndex,
            tran: DBTransaction,
          ) => AsyncGenerator<T, TReturn, TNext>,
        ]
      | [
          navigated: Readonly<{ dir: INodeIndex; name: string }>,
          ...inos: Array<INodeIndex>,
          g: (
            ino: INodeIndex,
            tran: DBTransaction,
          ) => AsyncGenerator<T, TReturn, TNext>,
        ]
  ): AsyncGenerator<T, TReturn, TNext> {
    const g = params.pop() as (
      ino: INodeIndex,
      tran: DBTransaction,
    ) => AsyncGenerator<T, TReturn, TNext>;
    let navigated: Readonly<{ dir: INodeIndex; name: string } | undefined>;
    if (typeof params[0] !== 'number') {
      navigated = params.shift() as Readonly<{ dir: INodeIndex; name: string }>;
    }
    const lockRequests = (params as Array<INodeIndex>).map<
      [INodeIndex, typeof Lock]
    >((ino) => [ino, Lock]);
    return withG(
      [
        this.inoAllocation(navigated),
        ([ino]: [INodeIndex]) =>
          this.locks.lock([ino, Lock], ...lockRequests)(),
        this.db.transaction(),
      ],
      ([ino, _, tran]) => g(ino, tran),
    );
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async fileCreate(
    ino: INodeIndex,
    params: FileParams,
    blkSize: number,
    data?: Buffer,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.fileCreate(ino, params, blkSize, data, tran),
      );
    }
    const statPath = [...this.statsDbPath, ino.toString()];
    const mode = constants.S_IFREG | ((params.mode ?? 0) & ~constants.S_IFMT);
    await this.iNodeCreate(
      'File',
      {
        ...params,
        ino,
        mode,
      },
      tran,
    );
    await this.statSetProp(ino, 'blksize', blkSize, tran);
    if (data) {
      await this.fileSetBlocks(ino, data, blkSize, 0, tran);
      await tran.put([...statPath, 'size'], data.length);
      await tran.put([...statPath, 'blocks'], Math.ceil(data.length / blkSize));
    }
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async dirCreate(
    ino: INodeIndex,
    params: DirectoryParams,
    parent?: INodeIndex,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(
        ino,
        ...(parent != null ? [parent] : []),
        async (tran) => this.dirCreate(ino, params, parent, tran),
      );
    }
    const mode = constants.S_IFDIR | ((params.mode ?? 0) & ~constants.S_IFMT);
    const dirPath = [...this.dirsDbPath, ino.toString()];
    let nlink: number;
    if (parent == null) {
      // Root can never be garbage collected
      nlink = 2;
      parent = ino;
      if ((await this.dirGetRoot(tran)) != null) {
        throw new inodesErrors.ErrorINodesDuplicateRoot(
          `Cannot create directory INode ${ino} as the root INode`,
        );
      }
      await this.dirSetRoot(ino, tran);
    } else {
      if ((await this.get(parent, tran)) == null) {
        throw new inodesErrors.ErrorINodesParentMissing(
          `Cannot create directory INode ${ino} with missing parent INode ${parent}`,
        );
      }
      nlink = 1;
    }
    await this.iNodeCreate(
      'Directory',
      {
        ...params,
        ino,
        mode,
        nlink,
      },
      tran,
    );
    if (nlink === 1) {
      await this.link(parent!, tran);
    }
    await tran.put([...dirPath, '.'], ino);
    await tran.put([...dirPath, '..'], parent);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async symlinkCreate(
    ino: INodeIndex,
    params: SymlinkParams,
    link: string,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.symlinkCreate(ino, params, link, tran),
      );
    }
    const mode = constants.S_IFLNK | ((params.mode ?? 0) & ~constants.S_IFMT);
    await this.iNodeCreate(
      'Symlink',
      {
        ...params,
        ino,
        mode,
      },
      tran,
    );
    await tran.put([...this.linkDbPath, inodesUtils.iNodeId(ino)], link);
  }

  protected async iNodeCreate(
    type: INodeType,
    params: INodeParams,
    tran: DBTransaction,
  ): Promise<void> {
    const statPath = [...this.statsDbPath, params.ino.toString()];
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
      [...this.iNodesDbPath, inodesUtils.iNodeId(params.ino as INodeIndex)],
      type,
    );
    await tran.put([...statPath, 'ino'], params.ino);
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
          await tran.put([...statPath, key], value);
          break;
        case 'atime':
        case 'mtime':
        case 'ctime':
        case 'birthtime':
          await tran.put([...statPath, key], (value as Date).getTime());
          break;
      }
    }
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async fileDestroy(
    ino: INodeIndex,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.fileDestroy(ino, tran),
      );
    }
    return this._fileDestroy(ino, tran);
  }

  protected async _fileDestroy(
    ino: INodeIndex,
    tran: DBTransaction,
  ): Promise<void> {
    const dataPath = [...this.dataDbPath, ino.toString()];
    for await (const [k] of tran.iterator({ value: false }, dataPath)) {
      await tran.del([...dataPath, k]);
    }
    await this.iNodeDestroy(ino, tran);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async dirDestroy(
    ino: INodeIndex,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.dirDestroy(ino, tran),
      );
    }
    return this._dirDestroy(ino, tran);
  }

  protected async _dirDestroy(
    ino: INodeIndex,
    tran: DBTransaction,
  ): Promise<void> {
    const dirPath = [...this.dirsDbPath, ino.toString()];
    const parent = (await tran.get<INodeIndex>([...dirPath, '..']))!;
    if (parent !== ino) {
      await this._unlink(parent, tran);
    } else {
      await this.dirUnsetRoot(tran);
    }
    for await (const [k] of tran.iterator({ values: false }, dirPath)) {
      await tran.del([...dirPath, k]);
    }
    await this.iNodeDestroy(ino, tran);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async symlinkDestroy(
    ino: INodeIndex,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.symlinkDestroy(ino, tran),
      );
    }
    return this._symlinkDestroy(ino, tran);
  }

  protected async _symlinkDestroy(
    ino: INodeIndex,
    tran: DBTransaction,
  ): Promise<void> {
    await tran.del([...this.linkDbPath, inodesUtils.iNodeId(ino)]);
    await this.iNodeDestroy(ino, tran);
  }

  protected async iNodeDestroy(
    ino: INodeIndex,
    tran: DBTransaction,
  ): Promise<void> {
    const statPath = [...this.statsDbPath, ino.toString()];
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
      await tran.del([...statPath, k]);
    }
    await tran.del([...this.iNodesDbPath, inodesUtils.iNodeId(ino)]);
    await tran.del([...this.gcDbPath, inodesUtils.iNodeId(ino)]);
  }

  /**
   * Gets the INodeData
   * Use this to test if an ino number exists
   * You can use the returned ino for subsequent operations
   */
  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async get(
    ino: INodeIndex,
    tran?: DBTransaction,
  ): Promise<INodeData | undefined> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) => this.get(ino, tran));
    }
    const type = await tran.get<INodeType>([
      ...this.iNodesDbPath,
      inodesUtils.iNodeId(ino as INodeIndex),
    ]);
    if (type == null) {
      return;
    }
    const gc = await tran.get<null>([
      ...this.gcDbPath,
      inodesUtils.iNodeId(ino as INodeIndex),
    ]);
    return {
      ino,
      type,
      gc: gc !== undefined,
    };
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async *getAll(tran?: DBTransaction): AsyncGenerator<INodeData> {
    if (tran == null) {
      return yield* this.withTransactionG((tran) => this.getAll(tran));
    }
    // Consistent iteration on iNodesDbPath and gcDbPath
    const gcIterator = tran.iterator(undefined, this.gcDbPath);
    try {
      for await (const [inoData, typeData] of tran.iterator(
        undefined,
        this.iNodesDbPath,
      )) {
        const ino = inodesUtils.uniNodeId(inoData as INodeId);
        const type = dbUtils.deserialize<INodeType>(typeData);
        gcIterator.seek(inoData);
        const gcData = (await gcIterator.next())?.[1];
        const gc =
          gcData != null ? dbUtils.deserialize<null>(gcData) : undefined;
        yield {
          ino,
          type,
          gc: gc !== undefined,
        };
      }
    } finally {
      await gcIterator.end();
    }
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async link(ino: INodeIndex, tran?: DBTransaction): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) => this.link(ino, tran));
    }
    const nlink = await this.statGetProp(ino, 'nlink', tran);
    await this.statSetProp(ino, 'nlink', nlink + 1, tran);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async unlink(ino: INodeIndex, tran?: DBTransaction): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) => this.unlink(ino, tran));
    }
    return this._unlink(ino, tran);
  }

  protected async _unlink(ino: INodeIndex, tran: DBTransaction): Promise<void> {
    const nlink = await this._statGetProp(ino, 'nlink', tran);
    await this._statSetProp(ino, 'nlink', Math.max(nlink - 1, 0), tran);
    await this.gc(ino, tran);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public ref(ino: INodeIndex) {
    const refCount = this.refs.get(ino) ?? 0;
    this.refs.set(ino, refCount + 1);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async unref(ino: INodeIndex, tran?: DBTransaction) {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) => this.unref(ino, tran));
    }
    const refCount = this.refs.get(ino);
    if (refCount == null) {
      return;
    }
    this.refs.set(ino, Math.max(refCount - 1, 0));
    await this.gc(ino, tran);
  }

  protected async gc(ino: INodeIndex, tran: DBTransaction): Promise<void> {
    const refs = this.refs.get(ino) ?? 0;
    const nlink = await this._statGetProp(ino, 'nlink', tran);
    const type = (await tran.get<INodeType>([
      ...this.iNodesDbPath,
      inodesUtils.iNodeId(ino),
    ]))!;
    // The root directory will never be deleted
    if (nlink === 0 || (nlink === 1 && type === 'Directory')) {
      if (refs === 0) {
        // Delete the on-disk and in-memory state
        switch (type) {
          case 'File':
            await this._fileDestroy(ino, tran);
            break;
          case 'Directory':
            await this._dirDestroy(ino, tran);
            break;
          case 'Symlink':
            await this._symlinkDestroy(ino, tran);
            break;
        }
        tran.queueSuccess(() => {
          this.refs.delete(ino);
          this.inoDeallocate(ino);
        });
      } else {
        // Schedule for deletion
        // when scheduled for deletion
        // it is not allowed for mutation of the directory to occur
        await tran.put([...this.gcDbPath, inodesUtils.iNodeId(ino)], null);
      }
    }
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async statGet(ino: INodeIndex, tran?: DBTransaction): Promise<Stat> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.statGet(ino, tran),
      );
    }
    const statPath = [...this.statsDbPath, ino.toString()];
    const props: Array<any> = await Promise.all([
      tran.get<number>([...statPath, 'dev']),
      tran.get<number>([...statPath, 'mode']),
      tran.get<number>([...statPath, 'nlink']),
      tran.get<number>([...statPath, 'uid']),
      tran.get<number>([...statPath, 'gid']),
      tran.get<number>([...statPath, 'rdev']),
      tran.get<number>([...statPath, 'size']),
      tran.get<number>([...statPath, 'blksize']),
      tran.get<number>([...statPath, 'blocks']),
      tran.get<number>([...statPath, 'atime']),
      tran.get<number>([...statPath, 'mtime']),
      tran.get<number>([...statPath, 'ctime']),
      tran.get<number>([...statPath, 'birthtime']),
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

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async statGetProp<Key extends keyof StatProps>(
    ino: INodeIndex,
    key: Key,
    tran?: DBTransaction,
  ): Promise<StatProps[Key]> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.statGetProp(ino, key, tran),
      );
    }
    return this._statGetProp(ino, key, tran);
  }

  protected async _statGetProp<Key extends keyof StatProps>(
    ino: INodeIndex,
    key: Key,
    tran: DBTransaction,
  ): Promise<StatProps[Key]> {
    const statPath = [...this.statsDbPath, ino.toString()];
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
        value = (await tran.get<number>([...statPath, key]))!;
        break;
      case 'atime':
      case 'mtime':
      case 'ctime':
      case 'birthtime':
        value = new Date((await tran.get<number>([...statPath, key]))!);
        break;
    }
    return value;
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async statSetProp<Key extends keyof StatProps>(
    ino: INodeIndex,
    key: Key,
    value: StatProps[Key],
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.statSetProp(ino, key, value, tran),
      );
    }
    return this._statSetProp(ino, key, value, tran);
  }

  protected async _statSetProp<Key extends keyof StatProps>(
    ino: INodeIndex,
    key: Key,
    value: StatProps[Key],
    tran: DBTransaction,
  ): Promise<void> {
    const statPath = [...this.statsDbPath, ino.toString()];
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
        await tran.put([...statPath, key], value);
        break;
      case 'atime':
      case 'mtime':
      case 'ctime':
      case 'birthtime':
        await tran.put([...statPath, key], (value as Date).getTime());
        break;
    }
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async statUnsetProp<Key extends keyof StatProps>(
    ino: INodeIndex,
    key: Key,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.statUnsetProp(ino, key, tran),
      );
    }
    const statPath = [...this.statsDbPath, ino.toString()];
    await tran.del([...statPath, key]);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async dirGetRoot(
    tran?: DBTransaction,
  ): Promise<INodeIndex | undefined> {
    if (tran == null) {
      return this.withTransactionF(async (tran) => this.dirGetRoot(tran));
    }
    return tran.get<INodeIndex>([...this.mgrDbPath, 'root']);
  }

  protected async dirSetRoot(
    ino: INodeIndex,
    tran: DBTransaction,
  ): Promise<void> {
    await tran.put([...this.mgrDbPath, 'root'], ino);
  }

  protected async dirUnsetRoot(tran: DBTransaction): Promise<void> {
    await tran.del([...this.mgrDbPath, 'root']);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async *dirGet(
    ino: INodeIndex,
    tran?: DBTransaction,
  ): AsyncGenerator<[string, INodeIndex]> {
    if (tran == null) {
      return yield* this.withTransactionG(ino, (tran) =>
        this.dirGet(ino, tran),
      );
    }
    for await (const [k, v] of tran.iterator(undefined, [
      ...this.dirsDbPath,
      ino.toString(),
    ])) {
      const name = k.toString('utf-8');
      const value = dbUtils.deserialize<INodeIndex>(v);
      yield [name, value];
    }
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async dirGetEntry(
    ino: INodeIndex,
    name: string,
    tran?: DBTransaction,
  ): Promise<INodeIndex | undefined> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.dirGetEntry(ino, name, tran),
      );
    }
    const dirPath = [...this.dirsDbPath, ino.toString()];
    return tran.get<INodeIndex>([...dirPath, name]);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async dirSetEntry(
    ino: INodeIndex,
    name: string,
    value: INodeIndex,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.dirSetEntry(ino, name, value, tran),
      );
    }
    const dirPath = [...this.dirsDbPath, ino.toString()];
    if ((await this.get(value, tran)) == null) {
      throw new inodesErrors.ErrorINodesIndexMissing(
        `Cannot set directory entry ${name} to missing INode ${ino}`,
      );
    }
    const existingValue = await tran.get<INodeIndex>([...dirPath, name]);
    if (existingValue === value) {
      return;
    }
    const now = new Date();
    await tran.put([...dirPath, name], value);
    await this.statSetProp(ino, 'mtime', now, tran);
    await this.statSetProp(ino, 'ctime', now, tran);
    await this.link(value, tran);
    if (existingValue != null) {
      await this.unlink(existingValue, tran);
    }
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async dirUnsetEntry(
    ino: INodeIndex,
    name: string,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.dirUnsetEntry(ino, name, tran),
      );
    }
    const dirPath = [...this.dirsDbPath, ino.toString()];
    const now = new Date();
    const existingValue = await tran.get<INodeIndex>([...dirPath, name]);
    if (existingValue == null) {
      return;
    }
    await tran.del([...dirPath, name]);
    await this.statSetProp(ino, 'mtime', now, tran);
    await this.statSetProp(ino, 'ctime', now, tran);
    await this.unlink(existingValue, tran);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async dirResetEntry(
    ino: INodeIndex,
    nameOld: string,
    nameNew: string,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.dirResetEntry(ino, nameOld, nameNew, tran),
      );
    }
    const dirPath = [...this.dirsDbPath, ino.toString()];
    const inoOld = await tran.get<INodeIndex>([...dirPath, nameOld]);
    if (inoOld == null) {
      throw new inodesErrors.ErrorINodesInvalidName(
        `Cannot set missing directory entry ${nameOld} to ${nameNew}`,
      );
    }
    const now = new Date();
    await this.statSetProp(ino, 'ctime', now, tran);
    await this.statSetProp(ino, 'mtime', now, tran);
    await this.statSetProp(inoOld, 'ctime', now, tran);
    const inoReplace = await this.dirGetEntry(ino, nameNew, tran);
    if (inoReplace) {
      await this.statSetProp(inoReplace, 'ctime', now, tran);
    }
    // The order must be set then unset
    // it cannot work if unset then set, the old inode may get garbage collected
    await this.dirSetEntry(ino, nameNew, inoOld, tran);
    await this.dirUnsetEntry(ino, nameOld, tran);
  }

  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async symlinkGetLink(
    ino: INodeIndex,
    tran?: DBTransaction,
  ): Promise<string> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.symlinkGetLink(ino, tran),
      );
    }
    const link = await tran.get<string>([
      ...this.linkDbPath,
      inodesUtils.iNodeId(ino),
    ]);
    return link!;
  }

  /**
   * Modified and Change Time are both updated here as this is
   * exposed to the EFS functions to be used
   */
  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async fileClearData(
    ino: INodeIndex,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.fileClearData(ino, tran),
      );
    }
    const dataPath = [...this.dataDbPath, ino.toString()];
    await tran.clear(dataPath);
  }

  /**
   * Access time not updated here, handled at higher level as this is only
   * accessed by fds and and other INodeMgr functions
   */
  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async *fileGetBlocks(
    ino: INodeIndex,
    blockSize: number,
    startIdx: number = 0,
    endIdx?: number,
    tran?: DBTransaction,
  ): AsyncGenerator<Buffer> {
    if (tran == null) {
      return yield* this.withTransactionG(ino, (tran) =>
        this.fileGetBlocks(ino, blockSize, startIdx, endIdx, tran),
      );
    }
    const options = endIdx
      ? {
          gte: inodesUtils.bufferId(startIdx),
          lt: inodesUtils.bufferId(endIdx),
        }
      : { gte: inodesUtils.bufferId(startIdx) };
    let blockCount = startIdx;
    for await (const [k, v] of tran.iterator(options, [
      ...this.dataDbPath,
      ino.toString(),
    ])) {
      // This is to account for the case where a some blocks are missing in a database
      // i.e. blocks 0 -> 3 have data and a write operation was performed on blocks 7 -> 8
      while (blockCount < inodesUtils.unbufferId(k as BufferId)) {
        yield Buffer.alloc(blockSize);
        blockCount++;
      }
      yield v;
      blockCount++;
    }
  }

  /**
   * Access time not updated here, handled at higher level as this is only
   * accessed by fds and and other INodeMgr functions
   */
  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async fileGetLastBlock(
    ino: INodeIndex,
    tran?: DBTransaction,
  ): Promise<[number, Buffer]> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.fileGetLastBlock(ino, tran),
      );
    }
    const options = { limit: 1, reverse: true };
    let key, value;
    for await (const [k, v] of tran.iterator(options, [
      ...this.dataDbPath,
      ino.toString(),
    ])) {
      key = inodesUtils.unbufferId(k as BufferId);
      value = v;
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
    ino: INodeIndex,
    idx: number,
    tran: DBTransaction,
  ): Promise<Buffer | undefined> {
    const dataPath = [...this.dataDbPath, ino.toString()];
    const key = inodesUtils.bufferId(idx);
    const buffer = await tran.get([...dataPath, key], true);
    if (!buffer) {
      return undefined;
    }
    return buffer;
  }

  /**
   * Modified and Change time not updated here, handled at higher level as this
   * is only accessed by fds and and other INodeMgr functions
   */
  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async fileSetBlocks(
    ino: INodeIndex,
    data: Buffer,
    blockSize: number,
    startIdx: number = 0,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.fileSetBlocks(ino, data, blockSize, startIdx, tran),
      );
    }
    const bufferSegments = utils.segmentBuffer(blockSize, data);
    let blockIdx = startIdx;
    for (const dataSegment of bufferSegments) {
      await this.fileWriteBlock(ino, dataSegment, blockIdx, 0, tran);
      blockIdx++;
    }
  }

  /**
   * Modified and Change time not updated here, handled at higher level as this
   * is only accessed by fds and other INodeMgr functions
   */
  @ready(new inodesErrors.ErrorINodeManagerNotRunning())
  public async fileWriteBlock(
    ino: INodeIndex,
    data: Buffer,
    idx: number,
    offset: number = 0,
    tran?: DBTransaction,
  ): Promise<number> {
    if (tran == null) {
      return this.withTransactionF(ino, async (tran) =>
        this.fileWriteBlock(ino, data, idx, offset, tran),
      );
    }
    const dataPath = [...this.dataDbPath, ino.toString()];
    let block = await this.fileGetBlock(ino, idx, tran);
    const key = inodesUtils.bufferId(idx);
    let bytesWritten;
    if (!block) {
      const newBlock = Buffer.alloc(offset + data.length);
      data.copy(newBlock, offset);
      await tran.put([...dataPath, key], newBlock, true);
      bytesWritten = data.length;
    } else {
      if (offset >= block.length) {
        // In this case we are not overwriting the data but appending
        const newBlock = Buffer.alloc(offset + data.length);
        block.copy(newBlock);
        bytesWritten = data.copy(newBlock, offset);
        await tran.put([...dataPath, key], newBlock, true);
      } else {
        // In this case we are overwriting
        if (offset + data.length > block.length) {
          block = Buffer.concat([
            block,
            Buffer.alloc(offset + data.length - block.length),
          ]);
        }
        bytesWritten = data.copy(block, offset);
        await tran.put([...dataPath, key], block, true);
      }
    }
    return bytesWritten;
  }
}

export default INodeManager;
