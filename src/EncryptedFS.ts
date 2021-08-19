import Logger from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from './db';
import { INodeManager } from './inodes';
import { maybeCallback } from './utils';

class EncryptedFS {

  protected db: DB;
  protected devMgr: vfs.DeviceManager;
  protected iNodeMgr: INodeManager;
  protected logger: Logger;

  public static async createEncryptedFS({
    dbKey,
    dbPath,
    db,
    devMgr,
    iNodeMgr,
    logger = new Logger(EncryptedFS.name)
  }: {
    dbKey: Buffer;
    dbPath: string;
    db?: DB;
    devMgr?: vfs.DeviceManager;
    iNodeMgr?: INodeManager;
    logger?: Logger
  }) {
    db = db ?? await DB.createDB({
      dbKey,
      dbPath,
      logger: logger.getChild(DB.name)
    });
    devMgr = devMgr ?? new vfs.DeviceManager();
    iNodeMgr = iNodeMgr ?? await INodeManager.createINodeManager({
      db,
      devMgr,
      logger: logger.getChild(INodeManager.name)
    });
    const efs = new EncryptedFS({
      db,
      devMgr,
      iNodeMgr,
      logger
    });
    await efs.start();

    // create root inode here

    return efs;
  }

  // synchronous constructor for the instance
  protected constructor ({
    db,
    devMgr,
    iNodeMgr,
    logger
  }: {
    db: DB;
    devMgr: vfs.DeviceManager;
    iNodeMgr: INodeManager;
    logger: Logger;
  }) {
    this.db = db;
    this.devMgr = devMgr;
    this.iNodeMgr = iNodeMgr;
    this.logger = logger;
  }

  get promises () {
    // return the promise based version of this
    // we can "return" this
    // but change the interface
    // createReadStream
    // createWriteStream
    // whatever right?
    // whatever provides the promise API
    return this;
  }

  public async start () {
    // start it up again
    // requires decryption keys
    // only after you stop it

    // create the initial root inode
    // well wait a minute
    // that's not exactly necessary

  }

  public async stop () {
    // shutdown the EFS instance
  }

  public async destroy (){
    // wipe out the entire FS
    await this.db.destroy();
  }

  // this is going to be callback based
  // using the maybeCallback
  public mkdir(
    path,
    modeOrCallback,
    callback
  ) {
    // run with this
    return maybeCallback(async () => {

    }, callback);
  }


  // we are going to use this
  protected navigate () {

  }

  protected navigateFrom () {

  }

}

export default EncryptedFS;
