import fs from 'fs';
import {
  VirtualFS,
  Stat,
  FileDescriptorManager,
  INodeManager,
  DeviceManager,
} from 'virtualfs';
import { WorkerManager } from './workers';
import constants from './constants';

class EncryptedFS extends VirtualFS {
  public readonly lowerFSRoot: string;
  public readonly blockSize: number;
  public readonly chunkSize: number;
  public readonly noatime: boolean;

  protected key: Buffer;
  protected lowerFS: typeof fs;
  protected workerManager?: WorkerManager;

  constructor (
    key: Buffer,
    lowerFS: typeof fs,
    lowerFSRoot: string = '',
    umask: number = 0o022,
    blockSize: number = 4096,
    noatime: boolean = false,
    devMgr: DeviceManager = new DeviceManager,
    iNodeMgr: INodeManager = new INodeManager(devMgr),
    fdMgr: FileDescriptorManager = new FileDescriptorManager(iNodeMgr)
  ) {
    super(umask, null, devMgr, iNodeMgr, fdMgr);
    this.key = key;
    this.blockSize = blockSize;
    this.lowerFS = lowerFS;
    this.lowerFSRoot = lowerFSRoot;
    this.noatime = noatime;
    this.chunkSize =
      this.blockSize +
      constants.INIT_VECTOR_LEN +
      constants.AUTH_TAG_LEN;
  }

  public setWorkerManager(workerManager: WorkerManager) {
    this.workerManager = workerManager;
  }

  public unsetWorkerManager() {
    delete this.workerManager;
  }

  // no need to get umask, getuid, setuid, getgid, setgid
  // all of it is extended from super






}

export default EncryptedFS;
