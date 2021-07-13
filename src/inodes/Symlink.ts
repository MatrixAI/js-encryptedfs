import type { MutexInterface } from 'async-mutex';
import type { INodeIndex } from './types';
import type { StatProps } from '../Stat';
import type { DBDomain, DBLevel, DBOp } from '../db/types';
import type { Callback } from '../types';

import * as vfs from 'virtualfs';
import callbackify from 'util-callbackify';
import INode, {
  makeStatDbDomain,
  makeStatDb,
  fillINodesDbOps,
  fillStatDbOps
} from './INode';
import INodeManager from './INodeManager';
import * as inodesUtils from './utils';

type SymlinkParams = Partial<StatProps> & Pick<
  StatProps,
  'ino' | 'mode'
>;

async function fillLinkDb(
  iNodeMgr: INodeManager,
  linkDbDomain: DBDomain,
  ino: INodeIndex,
  link: string,
): Promise<void>;
async function fillLinkDb(
  iNodeMgr: INodeManager,
  linkDbDomain: DBDomain,
  ino: INodeIndex,
  link: string,
  callback: Callback
): Promise<void>;
async function fillLinkDb(
  iNodeMgr: INodeManager,
  linkDbDomain: DBDomain,
  ino: INodeIndex,
  link: string,
  callback?: Callback
): Promise<void> {
  if (callback == null) {
    const ops = await fillLinkDbOps(linkDbDomain, ino, link);
    return iNodeMgr.db.batch(ops);
  } else {
    callbackify<
      INodeManager,
      DBDomain,
      INodeIndex,
      string,
      void
    >(fillLinkDb)(
      iNodeMgr,
      linkDbDomain,
      ino,
      link,
      callback
    );
    return;
  }
}

async function fillLinkDbOps(
  linkDbDomain: DBDomain,
  ino: INodeIndex,
  link: string,
): Promise<Array<DBOp>>;
async function fillLinkDbOps(
  linkDbDomain: DBDomain,
  ino: INodeIndex,
  link: string,
  callback: Callback<[Array<DBOp>]>
): Promise<void>;
async function fillLinkDbOps(
  linkDbDomain: DBDomain,
  ino: INodeIndex,
  link: string,
  callback?: Callback<[Array<DBOp>]>
): Promise<Array<DBOp> | void> {
  if (callback == null) {
    return [{
      type: 'put',
      domain: linkDbDomain,
      key: inodesUtils.iNodeId(ino),
      value: link
    }];
  } else {
    callbackify<
      DBDomain,
      INodeIndex,
      string,
      Array<DBOp>
    >(fillLinkDbOps)(
      linkDbDomain,
      ino,
      link,
      callback
    );
    return;
  }
}

class Symlink extends INode {

  public static async createSymlink(
    {
      params,
      link,
      iNodeMgr,
      lock,
    }: {
      params: SymlinkParams;
      link: string;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    }
  ): Promise<Symlink>;
  public static async createSymlink(
    {
      params,
      link,
      iNodeMgr,
      lock,
    }: {
      params: SymlinkParams;
      link: string;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback: Callback<[Symlink]>
  ): Promise<void>;
  public static async createSymlink(
    {
      params,
      link,
      iNodeMgr,
      lock,
    }: {
      params: SymlinkParams;
      link: string;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback?: Callback<[Symlink]>
  ): Promise<Symlink | void> {
    if (callback == null) {
      params.mode = vfs.constants.S_IFLNK | (params.mode & (~vfs.constants.S_IFMT));
      const size = Buffer.from(link).byteLength;
      const iNodesDbDomain = iNodeMgr.iNodesDbDomain;
      const iNodesDb = iNodeMgr.iNodesDb;
      const statDbDomain = makeStatDbDomain(iNodeMgr, params.ino);
      const linkDbDomain = iNodeMgr.iNodesLinkDbDomain;
      const linkDb = iNodeMgr.iNodesLinkDb;
      const statDb = await makeStatDb(iNodeMgr, statDbDomain);
      const [iNodesDbOps, statDbOps, linkDbOps] = await Promise.all([
        fillINodesDbOps(iNodesDbDomain, params.ino, 'Symlink'),
        fillStatDbOps(statDbDomain, { ...params, size }),
        fillLinkDbOps(linkDbDomain, params.ino, link)
      ]);
      await iNodeMgr.db.batch(iNodesDbOps.concat(statDbOps, linkDbOps));
      return new Symlink({
        iNodeMgr,
        lock,
        iNodesDbDomain,
        iNodesDb,
        statDbDomain,
        statDb,
        linkDbDomain,
        linkDb
      });
    } else {
      callbackify<
        {
          params: SymlinkParams;
          iNodeMgr: INodeManager;
          lock: MutexInterface;
        },
        Symlink
      >(this.createSymlink.bind(this))({
        params,
        iNodeMgr,
        lock
      }, callback);
      return;
    }
  }

  public static async loadSymlink(
    options: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
  ): Promise<Symlink>;
  public static async loadSymlink(
    options: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback: Callback<[Symlink]>
  ): Promise<void>;
  public static async loadSymlink(
    {
      iNodeIndex,
      iNodeMgr,
      lock,
    }: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback?: Callback<[Symlink]>
  ): Promise<Symlink | void> {
    if (callback == null) {
      const iNodesDbDomain = iNodeMgr.iNodesDbDomain;
      const iNodesDb = iNodeMgr.iNodesDb;
      const statDbDomain = makeStatDbDomain(iNodeMgr, iNodeIndex);
      const linkDbDomain = iNodeMgr.iNodesLinkDbDomain;
      const linkDb = iNodeMgr.iNodesLinkDb;
      const statDb = await makeStatDb(iNodeMgr, statDbDomain);
      return new Symlink({
        iNodeMgr,
        lock,
        iNodesDbDomain,
        iNodesDb,
        statDbDomain,
        statDb,
        linkDbDomain,
        linkDb
      });
    } else {
      callbackify<
        {
          iNodeIndex: INodeIndex;
          iNodeMgr: INodeManager;
          lock: MutexInterface;
        },
        Symlink
      >(this.loadSymlink.bind(this))({
        iNodeIndex,
        iNodeMgr,
        lock
      }, callback);
      return;
    }
  }

  protected linkDbDomain: DBDomain;
  protected linkDb: DBLevel;

  protected constructor (
    {
      iNodeMgr,
      lock,
      iNodesDbDomain,
      iNodesDb,
      statDbDomain,
      statDb,
      linkDbDomain,
      linkDb
    }: {
      iNodeMgr: INodeManager;
      lock: MutexInterface;
      iNodesDbDomain: DBDomain;
      iNodesDb: DBLevel;
      statDbDomain: DBDomain;
      statDb: DBLevel;
      linkDbDomain: DBDomain;
      linkDb: DBLevel;
    }
  ) {
    super({
      iNodeMgr,
      lock,
      iNodesDbDomain,
      iNodesDb,
      statDbDomain,
      statDb,
    });
    this.linkDbDomain = linkDbDomain;
    this.linkDb = linkDb;
  }

  public async getLink(): Promise<string>;
  public async getLink(callback: Callback<[string]>): Promise<void>;
  public async getLink(callback?: Callback<[string]>): Promise<string | void> {
    if (callback == null) {
      const ino = await this.getStatProp('ino');
      return this.iNodeMgr.db.get<string>(
        this.linkDbDomain,
        inodesUtils.iNodeId(ino)
      ) as Promise<string>;
    } else {
      callbackify<string>(this.getLink.bind(this))(callback);
      return;
    }
  }

  public async destroyOps(): Promise<Array<DBOp>>;
  public async destroyOps(callback: Callback<[Array<DBOp>]>): Promise<void>;
  public async destroyOps(callback?: Callback<[Array<DBOp>]>): Promise<Array<DBOp> | void> {
    if (callback == null) {
      const ino = await this.getStatProp('ino');
      return ([] as Array<DBOp>).concat(
        {
          type: 'del',
          domain: this.linkDbDomain,
          key: inodesUtils.iNodeId(ino)
        },
        await super.destroyOps()
      );
    } else {
      callbackify<Array<DBOp>>(this.destroyOps.bind(this))(callback);
      return;
    }
  }

}

export default Symlink;

export {
  fillLinkDb,
  fillLinkDbOps,
};

export type { SymlinkParams };
