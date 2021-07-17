import type fs from 'fs';
import type { INode, INodeManager } from 'virtualfs';

import { FileDescriptor, FileDescriptorManager } from 'virtualfs';

class EncryptedFileDescriptor<I extends INode> extends FileDescriptor<I> {

  // public readonly fdIndexLower: number;

  // constructor(iNode: I, flags: number, fdIndexLower: number) {
  //   super(iNode, flags);
  //   this.fdIndexLower = fdIndexLower;
  // }

}

// the problem is the call is different
// you now need 3 things
// so in a way are you sure you are a the upper
// you're not really extending the file descriptor manager
// you're creating a whole new one
// unless teh fdIndexLower is optional

class EncryptedFileDescriptorManager extends FileDescriptorManager {

  // protected fsLower: typeof fs;

  // constructor (fsLower: typeof fs, iNodeMgr: INodeManager) {
  //   super(iNodeMgr);
  //   this.fsLower = fsLower;
  // }

  // // this is not truely extending it
  // // cause the behaviour is different
  // // we can create new methods
  // // for doing this...
  // // plus it has to create new EncryptedFileDescriptor instead
  // // if the function type is different
  // // this wil lhave to be different
  // public createFdEncrypted (fdIndexLower, iNode, flags) {

  //   // so it's not truely extended
  //   // that's one of the problems here
  //   // it has to be a separate call now
  //   // since you need the lower first

  //   const fd = new EncryptedFileDescriptor();

  //   // if we create a fd here
  //   // we always creat with a target inode object
  //   // then with the flags
  //   // to maintain a lowerfs file descriptor
  //   // we may need to create it here too
  // }

  // public deleteFd (fdIndex: number): void {
  //   // the fdIndex here refers to the upperfs fd
  //   // internally it must keep track of the fd inside each fd
  //   // we are deleting the upper here
  //   // but in doing so
  //   // we must also delete other things

  //   // we must get the upper fd as well
  //   const fd = this._fds.get(fdIndex);
  //   // we will need to close this from the fs

  //   // and this is synchronous right?
  //   // or is opening something that we do asynchronously?
  //   this.fsLower.closeSync(fd.fdIndexLower);

  //   super.deleteFd(fdIndex);
  // }

}

// it's weird
// i don't exactly know whether i need this or not

export {
  EncryptedFileDescriptor,
  EncryptedFileDescriptorManager
};
