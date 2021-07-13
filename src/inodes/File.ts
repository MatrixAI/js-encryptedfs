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
import * as utils from '../utils';

type FileParams = Partial<StatProps> & Pick<
  StatProps,
  'ino' | 'mode'
>;

/**
 * Make the data db domain
 */
function makeDataDbDomain (
  iNodeMgr: INodeManager,
  ino: INodeIndex
): DBDomain {
  return [
    ...iNodeMgr.iNodesDataDbDomain,
    ino.toString()
  ];
}

/**
 * Make the data db
 */
function makeDataDb(
  iNodeMgr: INodeManager,
  dataDbDomain: DBDomain,
): Promise<DBLevel>;
function makeDataDb(
  iNodeMgr: INodeManager,
  dataDbDomain: DBDomain,
  callback: Callback<[DBLevel]>
): void;
function makeDataDb(
  iNodeMgr: INodeManager,
  dataDbDomain: DBDomain,
  callback?: Callback<[DBLevel]>
): Promise<DBLevel> | void {
  if (callback == null) {
    return iNodeMgr.db.level(
      dataDbDomain[dataDbDomain.length - 1],
      iNodeMgr.iNodesDataDb
    );
  } else {
    callbackify<INodeManager, DBDomain, DBLevel>(makeDataDb)(
      iNodeMgr,
      dataDbDomain,
      callback,
    );
    return;
  }
}

/**
 * Prefill the data database
 */
function fillDataDb(
  iNodeMgr: INodeManager,
  dataDbDomain: DBDomain,
  data: Buffer
): Promise<void>;
function fillDataDb(
  iNodeMgr: INodeManager,
  dataDbDomain: DBDomain,
  data: Buffer,
  callback: Callback
): void;
function fillDataDb(
  iNodeMgr: INodeManager,
  dataDbDomain: DBDomain,
  data: Buffer,
  callback?: Callback
): Promise<void> | void {
  if (callback == null) {
    return fillDataDbOps(dataDbDomain, data, 0).then((ops) => {
      return iNodeMgr.db.batch(ops);
    });
  } else {
    callbackify<INodeManager, DBDomain, Buffer, void>(fillDataDb)(
      iNodeMgr,
      dataDbDomain,
      data,
      callback,
    );
    return;
  }
}


// Slices the input buffer to the block size
// and creates an array of put ops with the
// lexi packed block indexes
// TODO: Find out where the block size comes from?
async function fillDataDbOps(
  dataDbDomain: DBDomain,
  data: Buffer,
  blockSize: number
): Promise<Array<DBOp>>;
async function fillDataDbOps(
  dataDbDomain: DBDomain,
  data: Buffer,
  blockSize: number,
  callback: Callback<[Array<DBOp>]>
): Promise<void>;
async function fillDataDbOps(
  dataDbDomain: DBDomain,
  data: Buffer,
  blockSize: number,
  callback?: Callback<[Array<DBOp>]>
): Promise<Array<DBOp> | void > {
  if (callback == null) {
    const ops: Array<DBOp> = [];
    const bufferSegments = utils.segmentBuffer(blockSize, data);
    let key, value;
    let blockIdx = 1;
    for (const dataSegment of bufferSegments) {
      key = inodesUtils.bufferId(blockIdx);
      value = dataSegment.toString();
      ops.push({
        type: 'put',
        domain: dataDbDomain,
        key,
        value
      });
      blockIdx++;
    }
    return ops;
  } else {
    callback(null, []);
    return;
  }
}

class File extends INode {

  public static async createFile(
    options: {
      params: FileParams;
      data?: Buffer;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    }
  ): Promise<File>;
  public static async createFile(
    options: {
      params: FileParams;
      data?: Buffer;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback: Callback<[File]>
  ): Promise<void>;
  public static async createFile(
    {
      params,
      data,
      iNodeMgr,
      lock,
    }: {
      params: FileParams;
      data?: Buffer;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback?: Callback<[File]>
  ): Promise<File | void> {
    if (callback == null) {
      params.mode = vfs.constants.S_IFREG | (params.mode & (~vfs.constants.S_IFMT));
      let size: number;
      if (data != null) {
        size = data.byteLength;
        //TODO:
        // calculate blksize based on block mapping
        // calculate the blocks on block mapping
        params.blksize = 0;
        params.blocks = 0;
      } else {
        size = 0;
      }
      const iNodesDbDomain = iNodeMgr.iNodesDbDomain;
      const iNodesDb = iNodeMgr.iNodesDb;
      const statDbDomain = makeStatDbDomain(iNodeMgr, params.ino);
      const dataDbDomain = makeDataDbDomain(iNodeMgr, params.ino);
      const [statDb, dataDb] = await Promise.all([
        makeStatDb(iNodeMgr, statDbDomain),
        makeDataDb(iNodeMgr, dataDbDomain)
      ]);
      const [iNodesDbOps, statDbOps, dataDbOps] = await Promise.all([
        fillINodesDbOps(
          iNodesDbDomain,
          params.ino,
          'File'
        ),
        fillStatDbOps(statDbDomain, {
          ...params,
          size
        }),
        (
          data != null
          ? fillDataDbOps(dataDbDomain, data, 5)
          : Promise.resolve([])
        )
      ]);
      await iNodeMgr.db.batch(iNodesDbOps.concat(statDbOps, dataDbOps));
      return new File({
        iNodeMgr,
        lock,
        iNodesDbDomain,
        iNodesDb,
        statDbDomain,
        statDb,
        dataDbDomain,
        dataDb
      });
    } else {
      callbackify<
        {
          params: FileParams;
          data?: Buffer;
          iNodeMgr: INodeManager;
          lock: MutexInterface;
        },
        File
      >(this.createFile.bind(this))({
        params,
        data,
        iNodeMgr,
        lock
      }, callback);
      return;
    }
  }

  public static async loadFile(
    options: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
  ): Promise<File>;
  public static async loadFile(
    options: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback: Callback<[File]>
  ): Promise<void>;
  public static async loadFile(
    {
      iNodeIndex,
      iNodeMgr,
      lock,
    }: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback?: Callback<[File]>
  ): Promise<File | void> {
    if (callback == null) {
      const iNodesDbDomain = iNodeMgr.iNodesDbDomain;
      const iNodesDb = iNodeMgr.iNodesDb;
      const statDbDomain = makeStatDbDomain(iNodeMgr, iNodeIndex);
      const dataDbDomain = makeDataDbDomain(iNodeMgr, iNodeIndex);
      const [statDb, dataDb] = await Promise.all([
        makeStatDb(iNodeMgr, statDbDomain),
        makeDataDb(iNodeMgr, dataDbDomain)
      ]);
      return new File({
        iNodeMgr,
        lock,
        iNodesDbDomain,
        iNodesDb,
        statDbDomain,
        statDb,
        dataDbDomain,
        dataDb
      });
    } else {
      callbackify<
        {
          iNodeIndex: INodeIndex;
          iNodeMgr: INodeManager;
          lock: MutexInterface;
        },
        File
      >(this.loadFile.bind(this))({
        iNodeIndex,
        iNodeMgr,
        lock
      }, callback);
      return;
    }
  }

  protected dataDbDomain: DBDomain;
  protected dataDb: DBLevel;

  protected constructor (
    {
      iNodeMgr,
      lock,
      iNodesDbDomain,
      iNodesDb,
      statDbDomain,
      statDb,
      dataDbDomain,
      dataDb,
    }: {
      iNodeMgr: INodeManager;
      lock: MutexInterface;
      iNodesDbDomain: DBDomain;
      iNodesDb: DBLevel;
      statDbDomain: DBDomain;
      statDb: DBLevel;
      dataDbDomain: DBDomain;
      dataDb: DBLevel;
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
    this.dataDbDomain = dataDbDomain;
    this.dataDb = dataDb;
  }

  // TODO:
  // the block mapping
  // functions will need to access get/put/del
  // on individual blocks
  // and potentially "batch" operations
  // unless the dataDbDomain was exposed?
  // or the mapping operations done here...

  // turn it into a buffer
  public async getBlocks(idxStart: number, idxEnd: number);
  public async getBlocks(idxStart: number, idxEnd: number, callback: Callback<[Buffer]>);
  public async *getBlocks(idxStart: number, idxEnd: number, callback?: Callback<[Buffer]>) {
    if (callback == null) {
      for await (const block of this.dataDb.createValueStream()) {
        const block = await this.iNodeMgr.db.get<Buffer>(this.dataDbDomain, inodesUtils.bufferId(1), true);
        if(!block) throw Error();
        console.log(block.toString());
        yield block;
      }
    } else {
      callbackify<number, number, Buffer>(this.getBlocks.bind(this))(idxStart, idxEnd, callback);
    }
  }


  // ops form?
  public setData(data: Buffer): Promise<void>;
  public setData(data: Buffer, callback: Callback): void;
  public setData(data: Buffer, callback?: Callback): Promise<void> | void {

  }

  public async destroyOps(): Promise<Array<DBOp>>;
  public async destroyOps(callback: Callback<[Array<DBOp>]>): Promise<void>;
  public async destroyOps(callback?: Callback<[Array<DBOp>]>): Promise<Array<DBOp> | void> {
    const keyStream = this.dataDb.createKeyStream();
    if (callback == null) {
      const destroyDataOps = (): Promise<Array<DBOp>> => {
        return new Promise<Array<DBOp>>((resolve, reject) => {
          const ops: Array<DBOp> = [];
          keyStream.on('data', (k) => {
            ops.push({
              type: 'del',
              domain: this.dataDbDomain,
              key: k
            });
          });
          keyStream.on('end', () => {
            resolve(ops);
          });
          keyStream.on('error', (e) => {
            reject(e);
          });
        });
      };
      return destroyDataOps().then((ops) => {
        return super.destroyOps().then((ops_) => {
          return ops.concat(ops_);
        });
      });
    } else {
      const destroyDataDbOps = (
        callback: Callback<[Array<DBOp>]>
      ): void => {
        const ops: Array<DBOp> = [];
        keyStream.on('data', (k) => {
          ops.push({
            type: 'del',
            domain: this.dataDbDomain,
            key: k
          });
        });
        keyStream.on('end', () => {
          callback(null, ops);
        });
        keyStream.on('error', (e) => {
          callback(e);
        });
      };
      destroyDataDbOps((e, ops) => {
        if (e != null) { callback(e); return; }
        super.destroyOps((e, ops_) => {
          if (e != null) { callback(e); return; }
          ops = ops.concat(ops_);
          callback(null, ops);
          return;
        });
        return;
      });
      return;
    }
  }

}

export default File;

export {
  makeDataDbDomain,
  makeDataDb,
  fillDataDb,
  fillDataDbOps
};

export type { FileParams };
