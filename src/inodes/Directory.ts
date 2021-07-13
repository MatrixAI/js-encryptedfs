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
import * as inodesErrors from './errors';

type DirectoryParams = Partial<StatProps> & Pick<
  StatProps,
  'ino' | 'mode'
>;

/**
 * Make the dir db domain
 */
function makeDirDbDomain (
  iNodeMgr: INodeManager,
  ino: INodeIndex
): DBDomain {
  return [
    ...iNodeMgr.iNodesDirDbDomain,
    ino.toString()
  ];
}

/**
 * Make the dir db
 */
async function makeDirDb(
  iNodeMgr: INodeManager,
  dirDbDomain: DBDomain,
): Promise<DBLevel>;
async function makeDirDb(
  iNodeMgr: INodeManager,
  dirDbDomain: DBDomain,
  callback: Callback<[DBLevel]>
): Promise<void>;
async function makeDirDb(
  iNodeMgr: INodeManager,
  dirDbDomain: DBDomain,
  callback?: Callback<[DBLevel]>
): Promise<DBLevel | void> {
  if (callback == null) {
    return iNodeMgr.db.level(
      dirDbDomain[dirDbDomain.length - 1],
      iNodeMgr.iNodesDirDb
    );
  } else {
    callbackify<
      INodeManager,
      DBDomain,
      DBLevel
    >(makeDirDb)(iNodeMgr, dirDbDomain, callback);
    return;
  }
}

/**
 * Fill the dir database
 */
async function fillDirDb(
  iNodeMgr: INodeManager,
  dirDbDomain: DBDomain,
  ino: INodeIndex,
  parent: INodeIndex
): Promise<void>;
async function fillDirDb(
  iNodeMgr: INodeManager,
  dirDbDomain: DBDomain,
  ino: INodeIndex,
  parent: INodeIndex,
  callback: Callback
): Promise<void>;
async function fillDirDb(
  iNodeMgr: INodeManager,
  dirDbDomain: DBDomain,
  ino: INodeIndex,
  parent: INodeIndex,
  callback?: Callback
): Promise<void> {
  if (callback == null) {
    const ops = await fillDirDbOps(dirDbDomain, ino, parent);
    return iNodeMgr.db.batch(ops);
  } else {
    callbackify<
      INodeManager,
      DBDomain,
      INodeIndex,
      INodeIndex,
      void
    >(fillDirDb)(iNodeMgr, dirDbDomain, ino, parent, callback);
    return;
  }
}

async function fillDirDbOps(
  dirDbDomain: DBDomain,
  ino: INodeIndex,
  parent: INodeIndex,
): Promise<Array<DBOp>>;
async function fillDirDbOps(
  dirDbDomain: DBDomain,
  ino: INodeIndex,
  parent: INodeIndex,
  callback: Callback<[Array<DBOp>]>
): Promise<void>;
async function fillDirDbOps(
  dirDbDomain: DBDomain,
  ino: INodeIndex,
  parent: INodeIndex,
  callback?: Callback<[Array<DBOp>]>
): Promise<Array<DBOp> | void> {
  if (callback == null) {
    return [
      {
        type: 'put',
        domain: dirDbDomain,
        key: '.',
        value: ino
      },
      {
        type: 'put',
        domain: dirDbDomain,
        key: '..',
        value: parent
      }
    ];
  } else {
    callbackify<
      DBDomain,
      INodeIndex,
      INodeIndex,
      Array<DBOp>
    >(fillDirDbOps)(
      dirDbDomain,
      ino,
      parent,
      callback
    );
    return;
  }
}

class Directory extends INode {

  public static async createDirectory(
    {
      params,
      parent,
      iNodeMgr,
      lock,
    }: {
      params: DirectoryParams;
      parent?: INode;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    }
  ): Promise<Directory>;
  public static async createDirectory(
    {
      params,
      parent,
      iNodeMgr,
      lock,
    }: {
      params: DirectoryParams;
      parent?: INode;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback: Callback<[Directory]>
  ): Promise<void>;
  public static async createDirectory(
    {
      params,
      parent,
      iNodeMgr,
      lock,
    }: {
      params: DirectoryParams;
      parent?: INode;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback?: Callback<[Directory]>
  ): Promise<Directory | void> {
    if (callback == null) {
      params.mode = vfs.constants.S_IFDIR | (params.mode & (~vfs.constants.S_IFMT));
      const iNodesDbDomain = iNodeMgr.iNodesDbDomain;
      const iNodesDb = iNodeMgr.iNodesDb;
      const statDbDomain = makeStatDbDomain(iNodeMgr, params.ino);
      const dirDbDomain = makeDirDbDomain(iNodeMgr, params.ino);
      const createDirectory = async (
        nlink: number,
        parentIndex: number,
        linkParentOps: Promise<Array<DBOp>>,
      ) => {
        const [statDb, dirDb] = await Promise.all([
          makeStatDb(iNodeMgr, statDbDomain),
          makeDirDb(iNodeMgr, dirDbDomain)
        ]);
        const ops = ([] as Array<DBOp>).concat(
          ...await Promise.all([
            fillINodesDbOps(
              iNodesDbDomain,
              params.ino,
              'Directory'
            ),
            fillStatDbOps(statDbDomain, {
              ...params,
              nlink
            }),
            fillDirDbOps(
              dirDbDomain,
              params.ino,
              parentIndex
            ),
            linkParentOps
          ])
        );
        await iNodeMgr.db.batch(ops);
        return new Directory({
          iNodeMgr,
          lock,
          iNodesDbDomain,
          iNodesDb,
          statDbDomain,
          statDb,
          dirDbDomain,
          dirDb,
        });
      };
      // only the root directory will start with an nlink of 2 due to '..'
      // otherwise it will start with an nlink of 1
      if (parent == null) {
        const nlink = 2;
        const parentIndex = params.ino;
        return createDirectory(
          nlink,
          parentIndex,
          Promise.resolve([])
        );
      } else {
        return parent.transaction(async () => {
          const nlink = 1;
          const parentIndex = await parent.getStatProp('ino');
          return createDirectory(
            nlink,
            parentIndex,
            iNodeMgr.linkINodeOps(parent)
          );
        });
      }
    } else {
      callbackify<
        {
          params: DirectoryParams;
          parent?: INode;
          iNodeMgr: INodeManager;
          lock: MutexInterface;
        },
        Directory
      >(this.createDirectory.bind(this))(
        {
          params,
          parent,
          iNodeMgr,
          lock
        },
        callback
      );
      return;
    }
  };

  // unless you can start it later?
  // so that would mean start + stop
  // then there's an asynchronous create
  // or asynchronous load
  // but the constructor

  // const d = new Directory(lock);
  // d.transaction(async () => {
  //   d.create();
  // });

  // maybe that would be better?
  // dirCreateOps
  // dirSetEntryOps
  // dirUnsetEntryOps

  public static async createDirectoryOps(
    {
      params,
      parent,
      iNodeMgr,
    }: {
      params: DirectoryParams;
      parent?: INode;
      iNodeMgr: INodeManager;
    }
  ): Promise<Array<DBOp>>;
  public static async createDirectory(
    {
      params,
      parent,
      iNodeMgr,
    }: {
      params: DirectoryParams;
      parent?: INode;
      iNodeMgr: INodeManager;
    },
    callback: Callback<[Array<DBOp>]>
  ): Promise<void>;
  public static async createDirectory(
    {
      params,
      parent,
      iNodeMgr,
    }: {
      params: DirectoryParams;
      parent?: INode;
      iNodeMgr: INodeManager;
    },
    callback?: Callback<[Array<DBOp>]>
  ): Promise<Array<DBOp> | void> {

    // you must lock prior
    // to doing this


    if (callback == null) {
      params.mode = vfs.constants.S_IFDIR | (params.mode & (~vfs.constants.S_IFMT));
      const iNodesDbDomain = iNodeMgr.iNodesDbDomain;
      const iNodesDb = iNodeMgr.iNodesDb;
      const statDbDomain = makeStatDbDomain(iNodeMgr, params.ino);
      const dirDbDomain = makeDirDbDomain(iNodeMgr, params.ino);

      const createDirectory = async (
        nlink: number,
        parentIndex: number,
        linkParentOps: Promise<Array<DBOp>>,
      ) => {
        const [statDb, dirDb] = await Promise.all([
          makeStatDb(iNodeMgr, statDbDomain),
          makeDirDb(iNodeMgr, dirDbDomain)
        ]);
        const ops = ([] as Array<DBOp>).concat(
          ...await Promise.all([
            fillINodesDbOps(
              iNodesDbDomain,
              params.ino,
              'Directory'
            ),
            fillStatDbOps(statDbDomain, {
              ...params,
              nlink
            }),
            fillDirDbOps(
              dirDbDomain,
              params.ino,
              parentIndex
            ),
            linkParentOps
          ])
        );
      };
      // only the root directory will start with an nlink of 2 due to '..'
      // otherwise it will start with an nlink of 1
      if (parent == null) {
        const nlink = 2;
        const parentIndex = params.ino;
        return createDirectory(
          nlink,
          parentIndex,
          Promise.resolve([])
        );
      } else {
        const nlink = 1;
        const parentIndex = await parent.getStatProp('ino');
        return createDirectory(
          nlink,
          parentIndex,
          iNodeMgr.linkINodeOps(parent)
        );
      }
    } else {


    }
  }

  public static async loadDirectory(
    options: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
  ): Promise<Directory>;
  public static async loadDirectory(
    options: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback: Callback<[Directory]>
  ): Promise<void>;
  public static async loadDirectory(
    {
      iNodeIndex,
      iNodeMgr,
      lock,
    }: {
      iNodeIndex: INodeIndex;
      iNodeMgr: INodeManager;
      lock: MutexInterface;
    },
    callback?: Callback<[Directory]>
  ): Promise<Directory | void> {
    if (callback == null) {
      const iNodesDbDomain = iNodeMgr.iNodesDbDomain;
      const iNodesDb = iNodeMgr.iNodesDb;
      const statDbDomain = makeStatDbDomain(iNodeMgr, iNodeIndex);
      const dirDbDomain = makeDirDbDomain(iNodeMgr, iNodeIndex);
      const [statDb, dirDb] = await Promise.all([
        makeStatDb(iNodeMgr, statDbDomain),
        makeDirDb(iNodeMgr, dirDbDomain)
      ]);
      return new Directory({
        iNodeMgr,
        lock,
        iNodesDbDomain,
        iNodesDb,
        statDbDomain,
        statDb,
        dirDbDomain,
        dirDb
      });
    } else {
      callbackify<
        {
          iNodeIndex: INodeIndex;
          iNodeMgr: INodeManager;
          lock: MutexInterface;
        },
        Directory
      >(this.loadDirectory.bind(this))(
        {
          iNodeIndex,
          iNodeMgr,
          lock,
        },
        callback
      );
      return;
    }
  }

  protected dirDbDomain: DBDomain;
  protected dirDb: DBLevel;

  protected constructor (
    {
      iNodeMgr,
      lock,
      iNodesDbDomain,
      iNodesDb,
      statDbDomain,
      statDb,
      dirDbDomain,
      dirDb,
    }: {
      iNodeMgr: INodeManager;
      lock: MutexInterface;
      iNodesDbDomain: DBDomain;
      iNodesDb: DBLevel;
      statDbDomain: DBDomain;
      statDb: DBLevel;
      dirDbDomain: DBDomain;
      dirDb: DBLevel;
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
    this.dirDbDomain = dirDbDomain;
    this.dirDb = dirDb;
  }

  public async getEntryIndex(name: string): Promise<number | undefined>;
  public async getEntryIndex(name: string, callback: Callback<[number | undefined]>): Promise<void>;
  public async getEntryIndex(name: string, callback?: Callback<[number | undefined]>): Promise<number | undefined | void> {
    if (callback == null) {
      return this._transaction(async () => {
        return await this.iNodeMgr.db.get<number>(
          this.dirDbDomain,
          name
        );
      });
    } else {
      callbackify<
        string,
        number | undefined
      >(this.getEntryIndex.bind(this))(
        name,
        callback
      );
      return;
    }
  }

  public async getEntry(name: string): Promise<INode | undefined>;
  public async getEntry(name: string, callback: Callback<[INode | undefined]>): Promise<void>;
  public async getEntry(name: string, callback?: Callback<[INode | undefined]>): Promise<INode | undefined | void> {
    if (callback == null) {
      return this._transaction(async () => {
        const iNodeIndex = await this.getEntryIndex(name);
        if (iNodeIndex == null) {
          return;
        }
        return await this.iNodeMgr.getINode(iNodeIndex);
      });
    } else {
      callbackify<
        string,
        INode | undefined
      >(this.getEntry.bind(this))(
        name,
        callback
      );
      return;
    }
  }

  public async addEntry(name: string, iNode: INode): Promise<void>;
  public async addEntry(name: string, iNode: INode, callback: Callback): Promise<void>;
  public async addEntry(name: string, iNode: INode, callback?: Callback): Promise<void> {
    if (callback == null) {
      if (name === '.' || name === '..') {
        throw new inodesErrors.ErrorINodesInvalidName;
      }
      await this._transaction(async () => {
        await iNode.transaction(async () => {
          const ops = await this.addEntryOps(name, iNode);
          await this.iNodeMgr.db.batch(ops);
        });
      });
    } else {
      callbackify<
        string,
        INode,
        void
      >(this.addEntry.bind(this))(
        name,
        iNode,
        callback
      );
      return;
    }
  }

  public async addEntryOps(name: string, iNode: INode): Promise<Array<DBOp>>;
  public async addEntryOps(name: string, iNode: INode, callback: Callback<[Array<DBOp>]>): Promise<void>;
  public async addEntryOps(name: string, iNode: INode, callback?: Callback<[Array<DBOp>]>): Promise<Array<DBOp> | void> {
    if (callback == null) {
      if (name === '.' || name === '..') {
        throw new inodesErrors.ErrorINodesInvalidName;
      }
      const iNodeIndex = await iNode.getStatProp('ino');
      // adding the entry to dirDb
      // updating mtime and ctime
      // incrementing the nlink
      return ([] as Array<DBOp>).concat(
        {
          type: 'put',
          domain: this.dirDbDomain,
          key: name,
          value: iNodeIndex
        },
        await this.setStatPropOps('mtime', new Date),
        await this.setStatPropOps('ctime', new Date),
        await this.iNodeMgr.linkINodeOps(iNode),
      );
    } else {
      callbackify<
        string,
        INode,
        Array<DBOp>
      >(this.addEntryOps.bind(this))(
        name,
        iNode,
        callback
      );
      return;
    }
  }

  public async deleteEntry(name: string): Promise<void>;
  public async deleteEntry(name: string): Promise<void>;
  public async deleteEntry(name: string, callback?: Callback): Promise<void> {
    if (callback == null) {
      await this._transaction(async () => {
        const iNode = await this.getEntry(name);
        if (iNode == null) {
          return;
        }
        await iNode.transaction(async () => {
          const ops = await this.deleteEntryOps(name);
          await this.iNodeMgr.db.batch(ops);
        });
      });
    } else {
      callbackify<string, void>(this.deleteEntry.bind(this))(
        name,
        callback
      );
      return;
    }
  }

  public async deleteEntryOps(name: string): Promise<Array<DBOp>>;
  public async deleteEntryOps(name: string, callback: Callback<[Array<DBOp>]>): Promise<void>;
  public async deleteEntryOps(name: string, callback?: Callback<[Array<DBOp>]>): Promise<Array<DBOp> | void> {
    if (callback == null) {
      if (name === '.' || name === '..') {
        throw new inodesErrors.ErrorINodesInvalidName;
      }
      const iNode = await this.getEntry(name);
      if (iNode == null) {
        return [];
      }
      return ([] as Array<DBOp>).concat(
        {
          type: 'del',
          domain: this.dirDbDomain,
          key: name,
        },
        await this.setStatPropOps('mtime', new Date),
        await this.setStatPropOps('ctime', new Date),
        await this.iNodeMgr.unlinkINodeOps(iNode),
      );
    } else {
      callbackify<string, Array<DBOp>>(this.deleteEntryOps.bind(this))(
        name,
        callback
      );
      return;
    }
  }

  /**
   * Rename a name in this directory
   */
  public async renameEntry(oldName: string, newName: string): Promise<void>;
  public async renameEntry(oldName: string, newName: string, callback: Callback): Promise<void>;
  public async renameEntry(oldName: string, newName: string, callback?: Callback): Promise<void> {
    if (callback == null) {
      this._transaction(async () => {
        const newINode = await this.getEntry(newName);
        if (newINode != null) {
          // the newINode is going to be overwritten
          // we will be unlinking that inode and thus we must enter into a transaction
          await newINode.transaction(async () => {
            const ops = await this.renameEntryOps(oldName, newName);
            return this.iNodeMgr.db.batch(ops);
          });
        } else {
          const ops = await this.renameEntryOps(oldName, newName);
          return this.iNodeMgr.db.batch(ops);
        }
      });
    } else {
      callbackify<string, string, void>(this.renameEntry.bind(this))(
        oldName,
        newName,
        callback
      );
      return;
    }
  }

  /**
   * May require unlinking (and thus locking) the inode designated by the newName
   */
  public async renameEntryOps(
    oldName: string,
    newName: string
  ): Promise<Array<DBOp>>;
  public async renameEntryOps(
    oldName: string,
    newName: string,
    callback: Callback<[Array<DBOp>]>
  ): Promise<void>;
  public async renameEntryOps(
    oldName: string,
    newName: string,
    callback?: Callback<[Array<DBOp>]>
  ): Promise<Array<DBOp> | void> {
    if (callback == null) {
      if (oldName === '.' || oldName === '..' || newName === '.' || newName === '..') {
        throw new inodesErrors.ErrorINodesInvalidName;
      }
      const oldIndex = await this.getEntryIndex(oldName);
      if (oldIndex == null) {
        throw new inodesErrors.ErrorINodesIndexMissing;
      }
      const ops = ([] as Array<DBOp>).concat(
        {
          type: 'del',
          domain: this.dirDbDomain,
          key: oldName
        },
        {
          type: 'put',
          domain: this.dirDbDomain,
          key: newName,
          value: oldIndex
        },
        await this.setStatPropOps('mtime', new Date),
        await this.setStatPropOps('ctime', new Date),
      );
      const newINode = await this.getEntry(newName);
      if (newINode != null) {
        ops.push(...await this.iNodeMgr.unlinkINodeOps(newINode));
      }
      return ops;
    } else {
      callbackify<string, string, Array<DBOp>>(this.renameEntryOps.bind(this))(
        oldName,
        newName,
        callback
      );
      return;
    }
  }

  // currently when we destroy
  // decrement parent's nlink
  // do not do this when it is on root
  // so it is a similar situation
  // also the nlink is not incremented when we create one

  // creating an inode doesn't add an nlink
  // because it is the act of adding it to a directory that does
  // directories are special during creation
  // directories are special during destruction
  // due to the parent link!

  // when the parent is removing it
  // it is removing an nlink to the inode
  // but you cannot hardlink directories
  // remember that
  // so the parent directory may be locking itself
  // while it tries to lock the sub directory (which itself is this._transaction)

  // parent directory removes /a
  // it is locking itself
  // it tries locking /a
  // which it succeeds

  // nohardlineks to directories should mean we can lock the parent directory here
  // on the destruction




  /**
   * Destroy the directory when all hardlinks and references to this inode reduce to 0.
   * This will also unlink the parent directory if it applies.
   */
  public async destroy(): Promise<void>;
  public async destroy(callback: Callback): Promise<void>;
  public async destroy(callback?: Callback): Promise<void> {

    // if we delete multiple entries here
    // it is one atomic operation each time
    // you don't just combine the destroyOps each time
    // but nothing is calling the destroy yet
    // cause the gcINode isn't working yet

    if (callback == null) {
      return this._transaction(async () => {
        const iNodeParent = await (this.getEntry('..') as Promise<INode>);
        if (iNodeParent !== this) {
          await iNodeParent._transaction(async () => {
            const ops = await this.destroyOps();
            return this.iNodeMgr.db.batch(ops);
          });
        } else {
          const ops = await this.destroyOps();
          return this.iNodeMgr.db.batch(ops);
        }
      });
    } else {
      callbackify(this.destroy.bind(this))(callback);
      return;
    }
  };

  public async destroyOps(): Promise<Array<DBOp>>;
  public async destroyOps(callback: Callback<[Array<DBOp>]>): Promise<void>;
  public async destroyOps(callback?: Callback<[Array<DBOp>]>): Promise<Array<DBOp> | void> {
    if (callback == null) {
      const ops: Array<DBOp> = [];
      // decrement the parent's nlink due to '..'
      // however do not do this on root otherwise there will be an infinite loop
      const iNodeParent = await (this.getEntry('..') as Promise<INode>);
      if (iNodeParent !== this) {
        ops.push(...await this.iNodeMgr.unlinkINodeOps(iNodeParent));
      }
      for await (const k of this.dirDb.createKeyStream()) {
        ops.push({
          type: 'del',
          domain: this.dirDbDomain,
          key: k
        });
      }
      ops.push(
        ...await super.destroyOps()
      );
      return ops;
    } else {
      callbackify<Array<DBOp>>(this.destroyOps.bind(this))(callback);
      return;
    }
  }

}

export default Directory;

export {
  makeDirDbDomain,
  makeDirDb,
  fillDirDb,
  fillDirDbOps
};

export type {
  DirectoryParams
};
