import fs from 'fs';
import pathNode from 'path';
import {
  VirtualFS,
  Stat,
  FileDescriptorManager,
  INodeManager,
  DeviceManager,
  constants
} from 'virtualfs';
import { WorkerManager } from './workers';
import * as utils from './utils';

  // we have to override the synchronous version versions
  // of each function in order to use the lower directory
  // and also to set the base path for the lower directory
  // we have to use a string
  // we cannot use this type
  // ith as to be preserved the same as VFS

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
      utils.cryptoConstants.INIT_VECTOR_LEN +
      utils.cryptoConstants.AUTH_TAG_LEN;
  }

  public setWorkerManager(workerManager: WorkerManager) {
    this.workerManager = workerManager;
  }

  public unsetWorkerManager() {
    delete this.workerManager;
  }

  // this would have to load
  // from the lower fs
  // then run it
  // have this re-export everything as usual
  public accessSync (path: string, mode: number = constants.F_OK): void {
    if (super.existsSync(path)) {
      super.accessSync(path, mode);
    } else {

      // consider this to be equivalent to block mapping
      this.loadMetaSync(this.getMetaName(path));
      this.setMetadata(path);

      super.accessSync(path, mode);
    }
  }

  // this is a string
  // that we are working against

  protected loadMetaSync (path: string): void {


    // what is this doing?

    let dir = pathNode.dirname(path.toString());

    dir = utils.addSuffix(dir);


    const file = pathNode.basename(path.toString());
    const metaChunkBuffer = this.lowerDir.readFileSync(
      `${this.lowerBasePath}/${dir}/.${file}.meta`,
    );
    const metaBlock = cryptoUtils.decryptChunk(this.masterKey, metaChunkBuffer);
    if (!metaBlock) {
      throw Error('Metadata decryption unsuccessful');
    }

    const metaPlainTrimmed = metaBlock.slice(0, metaBlock.indexOf('\0'));
    const fileMeta = JSON.parse(metaPlainTrimmed.toString());
    this.meta[this.getMetaName(path)] = fileMeta;

  }


  // public accessSync(path: string, ) {

  // }

  // no need to get umask, getuid, setuid, getgid, setgid
  // all of it is extended from super
  // any error that occurs from VirtualFS
  // should also be extended?
  // or should it come from EncryptedFSError?
  // to do so
  // we have throw new VirtualFSError
  // wrap all methods






}

export default EncryptedFS;
