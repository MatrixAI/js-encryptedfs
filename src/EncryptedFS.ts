import fs from 'fs';
import {
  VirtualFS,
  Stat,
  FileDescriptorManager,
  INodeManager,
  DeviceManager,
} from 'virtualfs';

// encryptedfs has an upper and lower
// the upper is basically VirtualFS
// the lower is always fs
// in this case we can wrap it by extending VirtualFS
// also umask?


class EncryptedFS extends VirtualFS {

  constructor (
    key: Buffer | string,

    lowerFS: typeof fs,
    lowerBasePath: string = '',

    umask: number = 0o022,
    blockSize: number = 4096,
    noatime: boolean = false,
  ) {

    // the umask of upper and lower has to match?
    // or is this the umask of the upper
    // this is the umask of the upper
    // not the umask of the lower
    // the umask of the lower is dependent on the context in which this is run

    const devMgr  = new DeviceManager();
    const iNodeMgr = new INodeManager(devMgr);
    const fdMgr = new FileDescriptorManager(iNodeMgr);
    super(umask, null, devMgr, iNodeMgr, fdMgr);



  }


}

export default EncryptedFS;
