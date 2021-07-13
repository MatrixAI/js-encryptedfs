import type { MutexInterface } from 'async-mutex';
import type { INodeIndex } from './types';
import type { StatProps } from '../Stat';
import type { DBDomain, DBLevel } from '../db/types';
import type { Callback } from '../types';

import * as vfs from 'virtualfs';
import callbackify from 'util-callbackify';
import INode, {
  makeStatDbDomain,
  makeStatDb,
  fillINodesDbOps,
  fillStatDbOps,
} from './INode';
import INodeManager from './INodeManager';

type CharacterDevParams = Partial<StatProps> & Pick<
  StatProps,
  'ino' | 'mode' | 'rdev'
>;

class CharacterDev extends INode {

  public static async createCharacterDev(
    {
      params,
      iNodeMgr,
      lock,
    }: {
      params: CharacterDevParams;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    }
  ): Promise<CharacterDev>;
  public static async createCharacterDev(
    {
      params,
      iNodeMgr,
      lock,
    }: {
      params: CharacterDevParams;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback: Callback<[CharacterDev]>
  ): Promise<void>;
  public static async createCharacterDev(
    {
      params,
      iNodeMgr,
      lock,
    }: {
      params: CharacterDevParams;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback?: Callback<[CharacterDev]>
  ): Promise<CharacterDev | void> {
    if (callback == null) {
      params.mode = vfs.constants.S_IFCHR | (params.mode & (~vfs.constants.S_IFMT));
      const iNodesDbDomain = iNodeMgr.iNodesDbDomain;
      const iNodesDb = iNodeMgr.iNodesDb;
      const statDbDomain = makeStatDbDomain(iNodeMgr, params.ino);
      const statDb = await makeStatDb(iNodeMgr, statDbDomain);
      const [iNodesDbOps, statDbOps] = await Promise.all([
        fillINodesDbOps(iNodesDbDomain, params.ino, 'CharacterDev'),
        fillStatDbOps(statDbDomain, {
          ...params
        }),
      ]);
      await iNodeMgr.db.batch(iNodesDbOps.concat(statDbOps));
      return new CharacterDev({
        iNodeMgr,
        lock,
        iNodesDbDomain,
        iNodesDb,
        statDbDomain,
        statDb,
      });
    } else {
      callbackify<
        {
          params: CharacterDevParams;
          iNodeMgr: INodeManager;
          lock: MutexInterface;
        },
        CharacterDev
      >(this.createCharacterDev.bind(this))({
        params,
        iNodeMgr,
        lock
      }, callback);
      return;
    }
  }

  public static async loadCharacterDev(
    options: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
  ): Promise<CharacterDev>;
  public static async loadCharacterDev(
    options: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback: Callback<[CharacterDev]>
  ): Promise<void>;
  public static async loadCharacterDev(
    {
      iNodeIndex,
      iNodeMgr,
      lock,
    }: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback?: Callback<[CharacterDev]>
  ): Promise<CharacterDev | void> {
    if (callback == null) {
      const iNodesDbDomain = iNodeMgr.iNodesDbDomain;
      const iNodesDb = iNodeMgr.iNodesDb;
      const statDbDomain = makeStatDbDomain(iNodeMgr, iNodeIndex);
      const statDb = await makeStatDb(iNodeMgr, statDbDomain);
      return new CharacterDev({
        iNodeMgr,
        lock,
        iNodesDbDomain,
        iNodesDb,
        statDbDomain,
        statDb,
      });
    } else {
      callbackify<
        {
          iNodeIndex: INodeIndex;
          iNodeMgr: INodeManager;
          lock: MutexInterface;
        },
        CharacterDev
      >(this.loadCharacterDev.bind(this))({
        iNodeIndex,
        iNodeMgr,
        lock
      }, callback);
      return;
    }
  }

  protected constructor (
    {
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
  }

  public async getFileDesOps(): Promise<vfs.DeviceInterface<vfs.CharacterDev> | undefined>;
  public async getFileDesOps(
    callback: Callback<[vfs.DeviceInterface<vfs.CharacterDev> | undefined]>
  ): Promise<void>;
  public async getFileDesOps(
    callback?: Callback<[vfs.DeviceInterface<vfs.CharacterDev> | undefined]>
  ): Promise<vfs.DeviceInterface<vfs.CharacterDev> | undefined | void> {
    if (callback == null) {
      const rdev = await this.getStatProp('rdev');
      const [major, minor] = vfs.unmkDev(rdev);
      return this.iNodeMgr.devMgr.getChr(major, minor);
    } else {
      callbackify<
        vfs.DeviceInterface<vfs.CharacterDev> | undefined
      >(this.getFileDesOps.bind(this))(callback);
      return;
    }
  }

}

export default CharacterDev;

export type { CharacterDevParams };
