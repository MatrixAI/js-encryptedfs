import type { INodeIndex } from '../inodes/types';
import type { FdIndex } from './types';
import type { INodeManager } from '../inodes';
import Counter from 'resource-counter';
import FileDescriptor from './FileDescriptor';

/**
 * Class that manages all FileDescriptors
 */
class FileDescriptorManager {
  protected _counter: Counter;
  protected _fds: Map<FdIndex, FileDescriptor>;
  protected _iNodeMgr: INodeManager;

  /**
   * Creates an instance of the FileDescriptorManager.
   * It starts the fd counter at 0.
   * Make sure not get real fd numbers confused with these fd numbers.
   */
  constructor(iNodeMgr: INodeManager) {
    this._counter = new Counter(0);
    this._fds = new Map();
    this._iNodeMgr = iNodeMgr;
  }

  /**
   * Creates a file descriptor.
   * This will increment the reference to the iNode preventing garbage collection by the INodeManager.
   */
  public async createFd(
    ino: INodeIndex,
    flags: number,
  ): Promise<[FileDescriptor, FdIndex]> {
    const index = this._counter.allocate();
    const fd = new FileDescriptor(this._iNodeMgr, ino, flags);
    // Set the file descriptor into the map
    this._fds.set(index, fd);
    // Create a reference to the INode
    this._iNodeMgr.ref(ino);
    return [fd, index];
  }

  /**
   * Gets the file descriptor object.
   */
  public getFd(fdIndex: FdIndex): FileDescriptor | undefined {
    return this._fds.get(fdIndex);
  }

  /**
   * Duplicates file descriptor index.
   * It may return a new file descriptor index that points to the same file descriptor.
   */
  public dupFd(fdIndex: FdIndex): FdIndex | undefined {
    const fd = this._fds.get(fdIndex);
    if (fd) {
      this._iNodeMgr.ref(fd.ino);
      const dupIndex = this._counter.allocate();
      this._fds.set(dupIndex, fd);
      return dupIndex;
    }
  }

  /**
   * Deletes a file descriptor.
   * This effectively closes the file descriptor.
   * This will decrement the reference to the iNode allowing garbage collection by the INodeManager.
   */
  public async deleteFd(fdIndex: FdIndex): Promise<void> {
    const fd = this._fds.get(fdIndex);
    if (fd) {
      this._fds.delete(fdIndex);
      this._counter.deallocate(fdIndex);
      await this._iNodeMgr.withTransactionF(fd.ino, async (tran) => {
        await this._iNodeMgr.unref(fd.ino, tran);
      });
    }
    return;
  }
}

export default FileDescriptorManager;
