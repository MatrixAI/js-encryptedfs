import type { MutexInterface } from 'async-mutex';
import type { INodeIndex, INodeType } from './types';
import type { DBDomain, DBLevel, DBOp } from '../db/types';
import type { StatProps } from '../Stat';
import type { Callback } from '../types';

import * as vfs from 'virtualfs';
import callbackify from 'util-callbackify';
import INodeManager from './INodeManager';
import * as inodesUtils from './utils';
import Stat from '../Stat';

type INodeParams = Partial<StatProps> & Pick<StatProps, 'ino' | 'mode'>;

async function fillINodesDb(
  iNodeMgr: INodeManager,
  iNodesDbDomain: DBDomain,
  iNodeIndex: INodeIndex,
  type: INodeType,
): Promise<void>;
async function fillINodesDb(
  iNodeMgr: INodeManager,
  iNodesDbDomain: DBDomain,
  iNodeIndex: INodeIndex,
  type: INodeType,
  callback: Callback
): Promise<void>;
async function fillINodesDb(
  iNodeMgr: INodeManager,
  iNodesDbDomain: DBDomain,
  iNodeIndex: INodeIndex,
  type: INodeType,
  callback?: Callback
): Promise<void> {
  if (callback == null) {
    const ops = await fillINodesDbOps(iNodesDbDomain, iNodeIndex, type);
    return iNodeMgr.db.batch(ops);
  } else {
    callbackify<INodeManager, DBDomain, INodeIndex, INodeType, void>(fillINodesDb)(
      iNodeMgr,
      iNodesDbDomain,
      iNodeIndex,
      type,
      callback
    );
    return;
  }
}

async function fillINodesDbOps(
  iNodesDbDomain: DBDomain,
  iNodeIndex: INodeIndex,
  type: INodeType,
): Promise<Array<DBOp>>;
async function fillINodesDbOps(
  iNodesDbDomain: DBDomain,
  iNodeIndex: INodeIndex,
  type: INodeType,
  callback: Callback<[Array<DBOp>]>
): Promise<void>;
async function fillINodesDbOps (
  iNodesDbDomain: DBDomain,
  iNodeIndex: INodeIndex,
  type: INodeType,
  callback?: Callback<[Array<DBOp>]>
): Promise<Array<DBOp> | void> {
  if (callback == null) {
    return [{
      type: 'put',
      domain: iNodesDbDomain,
      key: inodesUtils.iNodeId(iNodeIndex),
      value: type
    }];
  } else {
    callbackify<DBDomain, INodeIndex, INodeType, Array<DBOp>>(fillINodesDbOps)(
      iNodesDbDomain,
      iNodeIndex,
      type,
      callback
    );
    return;
  }
}

/**
 * Make the stat db domain
 */
function makeStatDbDomain (
  iNodeMgr: INodeManager,
  ino: INodeIndex
): DBDomain {
  return [
    ...iNodeMgr.iNodesStatDbDomain,
    ino.toString()
  ];
}

/**
 * Make the stat db
 */
async function makeStatDb(
  iNodeMgr: INodeManager,
  statDbDomain: DBDomain,
): Promise<DBLevel>;
async function makeStatDb(
  iNodeMgr: INodeManager,
  statDbDomain: DBDomain,
  callback: Callback<[DBLevel]>
): Promise<void>;
async function makeStatDb(
  iNodeMgr: INodeManager,
  statDbDomain: DBDomain,
  callback?: Callback<[DBLevel]>
): Promise<DBLevel | void> {
  if (callback == null) {
    return iNodeMgr.db.level(
      statDbDomain[statDbDomain.length - 1],
      iNodeMgr.iNodesStatDb
    );
  } else {
    callbackify<INodeManager, DBDomain, DBLevel>(makeStatDb)(
      iNodeMgr,
      statDbDomain,
      callback
    );
    return;
  }
}

/**
 * Prefill the stat db
 * Several stat parameters are optional
 */
async function fillStatDb(
  iNodeMgr: INodeManager,
  statDbDomain: DBDomain,
  params: INodeParams
): Promise<void>;
async function fillStatDb(
  iNodeMgr: INodeManager,
  statDbDomain: DBDomain,
  params: INodeParams,
  callback: Callback
): Promise<void>;
async function fillStatDb(
  iNodeMgr: INodeManager,
  statDbDomain: DBDomain,
  params: INodeParams,
  callback?: Callback
): Promise<void> {
  if (callback == null) {
    const ops = await fillStatDbOps(statDbDomain, params);
    return iNodeMgr.db.batch(ops);
  } else {
    callbackify<INodeManager, DBDomain, INodeParams, void>(fillStatDb)(
      iNodeMgr,
      statDbDomain,
      params,
      callback
    );
    return;
  }
}

async function fillStatDbOps(
  statDbDomain: DBDomain,
  params: INodeParams,
): Promise<Array<DBOp>>;
async function fillStatDbOps(
  statDbDomain: DBDomain,
  params: INodeParams,
  callback: Callback<[Array<DBOp>]>
): Promise<void>;
async function fillStatDbOps(
  statDbDomain: DBDomain,
  params: INodeParams,
  callback?: Callback<[Array<DBOp>]>
): Promise<Array<DBOp> | void> {
  if (callback == null) {
    params.dev = params.dev ?? 0;
    params.nlink = params.nlink ?? 0;
    params.uid = params.uid ?? vfs.DEFAULT_ROOT_UID;
    params.gid = params.gid ?? vfs.DEFAULT_ROOT_GID;
    params.rdev = params.rdev ?? 0;
    params.size = params.size ?? 0;
    params.blksize = params.blksize ?? 0;
    params.blocks = params.blocks ?? 0;
    params.atime = params.atime ?? new Date();
    params.mtime = params.mtime ?? new Date();
    params.ctime = params.ctime ?? new Date();
    params.birthtime = params.birthtime ?? new Date();
    const ops: Array<DBOp> = [];
    for (const [key, value] of Object.entries(params)) {
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
          ops.push({
            type: 'put',
            domain: statDbDomain,
            key,
            value
          });
          break;
        case 'atime':
        case 'mtime':
        case 'ctime':
        case 'birthtime':
          ops.push({
            type: 'put',
            domain: statDbDomain,
            key,
            value: (value as Date).getTime()
          });
          break;
      }
    }
    return ops;
  } else {
    callbackify<DBDomain, INodeParams, Array<DBOp>>(fillStatDbOps)(
      statDbDomain,
      params,
      callback
    );
    return;
  }
}

/**
 * Class representing an generic iNode
 * Specific INodes inherit from this abstract class
 */
abstract class INode {

  protected iNodeMgr: INodeManager;
  protected iNodesDbDomain: DBDomain;
  protected iNodesDb: DBLevel;
  protected statDbDomain: DBDomain;
  protected statDb: DBLevel;
  protected lock: MutexInterface;

  /**
   * Creates iNode
   * INode and INodeManager will recursively call each other.
   * It is expected that the stat database will be prefilled
   * with required metadata by subclass smart constructors
   */
  protected constructor ({
    iNodeMgr,
    lock,
    iNodesDbDomain,
    iNodesDb,
    statDbDomain,
    statDb,
  }: {
    iNodeMgr: INodeManager;
    lock: MutexInterface;
    iNodesDbDomain: DBDomain;
    iNodesDb: DBLevel;
    statDbDomain: DBDomain;
    statDb: DBLevel;
  }) {
    this.iNodeMgr = iNodeMgr;
    this.lock = lock;
    this.iNodesDbDomain = iNodesDbDomain;
    this.iNodesDb = iNodesDb;
    this.statDbDomain = statDbDomain;
    this.statDb = statDb;
  }

  get locked(): boolean {
    return this.lock.isLocked();
  }

  /**
   * Run several operations within the same lock
   * This does not ensure atomicity of the underlying database
   * Database atomicity still depends on the underlying operation
   */
  public async transaction<T>(f: (that: this) => Promise<T>): Promise<T>;
  public async transaction(f: (that: this) => void): Promise<void>;
  public async transaction(f: any): Promise<any | void> {
    const release = await this.lock.acquire();
    try {
      return f(this);
    } finally {
      release();
    }
  }

  /**
   * Transaction wrapper that will not lock if the operation was executed
   * within a transaction context
   */
  public async _transaction<T>(f: () => Promise<T>): Promise<T>;
  public async _transaction(f: () => void): Promise<void>;
  public async _transaction(f: any): Promise<any| void> {
    if (this.lock.isLocked()) {
      return f();
    } else {
      return this.transaction(f);
    }
  }

  /**
   * Get all the meta values and construct a Stat object
   * The Stat object is used as a container of inode statistics
   */
  public async getStat(): Promise<Stat>;
  public async getStat(callback: Callback<[Stat]>): Promise<void>;
  public async getStat(callback?: Callback<[Stat]>): Promise<Stat | void> {
    if (callback == null) {
      // @ts-ignore TS doesn't deal with more than 10 promises
      const props = await Promise.all([
        this.getStatProp('dev'),
        this.getStatProp('ino'),
        this.getStatProp('mode'),
        this.getStatProp('nlink'),
        this.getStatProp('uid'),
        this.getStatProp('gid'),
        this.getStatProp('rdev'),
        this.getStatProp('size'),
        this.getStatProp('blksize'),
        this.getStatProp('blocks'),
        this.getStatProp('atime'),
        this.getStatProp('mtime'),
        this.getStatProp('ctime'),
        this.getStatProp('birthtime'),
      ]);
      const [
        dev, ino, mode, nlink, uid, gid, rdev, size, blksize, blocks,
        atime, mtime, ctime, birthtime
      ]: Array<any> = props;
      return new Stat({
        dev, ino, mode, nlink, uid, gid, rdev, size, blksize, blocks,
        atime, mtime, ctime, birthtime
      });
    } else {
      callbackify<Stat>(this.getStat.bind(this))(
        callback
      );
      return;
    }
  }

  /**
   * Get a Stat property
   */
  public async getStatProp<Key extends keyof StatProps>(
    key: Key
  ): Promise<StatProps[Key]>;
  public async getStatProp<Key extends keyof StatProps>(
    key: Key,
    callback: Callback<[StatProps[Key]]>
  ): Promise<void>;
  public async getStatProp<Key extends keyof StatProps>(
    key: Key,
    callback?: Callback<[StatProps[keyof StatProps]]>
  ): Promise<StatProps[keyof StatProps] | void> {
    if (callback == null) {
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
          return this.iNodeMgr.db.get<number>(this.statDbDomain, key) as Promise<number>;
        case 'atime':
        case 'mtime':
        case 'ctime':
        case 'birthtime':
          const stamp = await this.iNodeMgr.db.get<number>(this.statDbDomain, key);
          return new Date(stamp!);
      }
    } else {
      callbackify<Key, StatProps[Key]>(this.getStatProp.bind(this))(
        key,
        callback
      );
      return;
    }
  }

  /**
   * Set a Stat property
   */
  public async setStatProp<Key extends keyof StatProps>(
    key: Key,
    value: StatProps[Key]
  ): Promise<void>;
  public async setStatProp<Key extends keyof StatProps>(
    key: Key,
    value: StatProps[Key],
    callback: Callback
  ): Promise<void>;
  public async setStatProp<Key extends keyof StatProps>(
    key: Key,
    value: StatProps[Key],
    callback?: Callback
  ): Promise<void> {
    if (callback == null) {
      return this._transaction(async () => {
        const ops = await this.setStatPropOps(key, value);
        return this.iNodeMgr.db.batch(ops);
      });
    } else {
      callbackify<Key, StatProps[Key], void>(this.setStatProp.bind(this))(
        key,
        value,
        callback
      );
      return;
    }
  }

  /**
   * Set a Stat property ops
   */
  public async setStatPropOps<Key extends keyof StatProps>(
    key: Key,
    value: StatProps[Key]
  ): Promise<Array<DBOp>>;
  public async setStatPropOps<Key extends keyof StatProps>(
    key: Key,
    value: StatProps[Key],
    callback: Callback<[Array<DBOp>]>
  ): Promise<void>;
  public async setStatPropOps<Key extends keyof StatProps>(
    key: Key,
    value: StatProps[Key],
    callback?: Callback<[Array<DBOp>]>
  ): Promise<Array<DBOp> | void> {
    if (callback == null) {
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
          return [{
            type: 'put',
            domain: this.statDbDomain,
            key,
            value
          }];
        case 'atime':
        case 'mtime':
        case 'ctime':
        case 'birthtime':
          return [{
            type: 'put',
            domain: this.statDbDomain,
            key,
            // @ts-ignore
            value: value.getTime()
          }];
      }
    } else {
      callbackify<Key, StatProps[Key], Array<DBOp>>(this.setStatPropOps.bind(this))(
        key,
        value,
        callback
      );
      return;
    }
  }

  /**
   * Unset a Stat property
   */
  public async unsetStatProp<Key extends keyof StatProps>(
    key: Key,
  ): Promise<void>;
  public async unsetStatProp<Key extends keyof StatProps>(
    key: Key,
    callback: Callback
  ): Promise<void>;
  public async unsetStatProp<Key extends keyof StatProps>(
    key: Key,
    callback?: Callback
  ): Promise<void> {
    if (callback == null) {
      return this._transaction(async () => {
        const ops = await this.unsetStatPropOps(key);
        return this.iNodeMgr.db.batch(ops);
      });
    } else {
      callbackify<Key, void>(this.unsetStatProp.bind(this))(
        key,
        callback
      );
      return;
    }
  }

  /**
   * Unset a Stat property ops
   */
  public async unsetStatPropOps<Key extends keyof StatProps>(
    key: Key,
  ): Promise<Array<DBOp>>;
  public async unsetStatPropOps<Key extends keyof StatProps>(
    key: Key,
    callback: Callback<[Array<DBOp>]>
  ): Promise<void>;
  public async unsetStatPropOps<Key extends keyof StatProps>(
    key: Key,
    callback?: Callback<[Array<DBOp>]>
  ): Promise<Array<DBOp> | void> {
    if (callback == null) {
      return [{
        type: 'del',
        domain: this.statDbDomain,
        key
      }];
    } else {
      callbackify<Key, Array<DBOp>>(this.unsetStatPropOps.bind(this))(
        key,
        callback
      );
      return;
    }
  }

  /**
   * Destroy the inode
   * Conduct cleanup operations within a transaction
   */
  public async destroy(): Promise<void>;
  public async destroy(callback: Callback): Promise<void>;
  public async destroy(callback?: Callback): Promise<void> {
    if (callback == null) {
      return this._transaction(async () => {
        const ops = await this.destroyOps();
        return this.iNodeMgr.db.batch(ops);
      });
    } else {
      callbackify(this.destroy.bind(this))(callback);
      return;
    }
  }

  /**
   * Destroy the inode
   * This will destroy the stat database for this inode
   * Override this to include further operations
   */
  public async destroyOps(): Promise<Array<DBOp>>;
  public async destroyOps(callback: Callback<[Array<DBOp>]>): Promise<void>;
  public async destroyOps(callback?: Callback<[Array<DBOp>]>): Promise<Array<DBOp> | void> {
    if (callback == null) {
      const iNodeIndex = await this.getStatProp('ino');
      const ops: Array<DBOp> = [];
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
        ops.push({
          type: 'del',
          domain: this.statDbDomain,
          key: k
        });
      }
      ops.push({
        type: 'del',
        domain: this.iNodesDbDomain,
        key: inodesUtils.iNodeId(iNodeIndex)
      })
      return ops;
    } else {
      callbackify<Array<DBOp>>(this.destroyOps.bind(this))(callback);
      return;
    }
  }

}

export default INode;

export {
  makeStatDbDomain,
  makeStatDb,
  fillINodesDb,
  fillINodesDbOps,
  fillStatDb,
  fillStatDbOps
};
