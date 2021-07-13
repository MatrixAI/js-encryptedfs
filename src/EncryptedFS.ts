import fs from 'fs';
import {
  VirtualFS,
  Stat,
  FileDescriptorManager,
  INodeManager,
  DeviceManager,
} from 'virtualfs';

import constants from './constants';

// encryptedfs has an upper and lower
// the upper is basically VirtualFS
// the lower is always fs
// in this case we can wrap it by extending VirtualFS
// also umask?

// when you open and close this
// you have to consider that the VirtualFS is holding it all in memory
// so once you open you have to later close it
// unless there arem ultiple ones

// you pass in a lowerFS
// we expect this to normal fs
// so we need to start at  a lower base path

class EncryptedFS extends VirtualFS {
  public readonly lowerFSRoot: string;
  public readonly blockSize: number;
  public readonly chunkSize: number;
  public readonly noatime: boolean;

  protected key: Buffer;
  protected lowerFS: typeof fs;

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




}

export default EncryptedFS;
