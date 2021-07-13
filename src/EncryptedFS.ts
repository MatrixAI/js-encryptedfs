import fs from 'fs';
import pathNode from 'path';
import canonicalize from 'canonicalize';
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
import { EncryptedFSError, errno } from './EncryptedFSError';

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

  public access (path: string, ...args: Array<any>): void {

    // this is asynchronous
    // this calls the access sync bind
    // with the cb index
    // but we really need to do things asynchronously

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
  // the access sync
  // is performing synchronous multiple times
  // so the whole thing is running in the background?
  // well that only makes sense if its all in-memory ops anyway
  // but here when we run readFileSync that's going to block the entire thread

  // we need async and sync versions of this
  // otherwise the sync version is going to do something weird

  // sync vs async
  // we will need an async version of this function

  protected loadMetaSync (path: string): void {
    const pathLower = utils.translatePathMeta(path);
    let metaCipher: Buffer;
    try {
      metaCipher = this.lowerFS.readFileSync(
        utils.pathJoin(this.lowerFSRoot, pathLower)
      );
    } catch (e) {
      if (e.code in errno) {
        throw new EncryptedFSError(
          errno[e.code],
          e.path,
          e.dest,
          e.syscall
        );
      } else {
        throw e;
      }
    }
    const metaPlain = utils.decryptWithKey(this.key, metaCipher);
    if (metaPlain == null) {
      throw new EncryptedFSError(
        {
          errno: -1,
          code: 'UNKNOWN',
          description: 'Metadata decryption failed'
        },
        pathLower,
      );
    }
    const metaValue = JSON.parse(metaPlain.toString('utf-8'));

    // here we are storing the meta the meta map!
    this.metaMap[this.getMetaName(pathLower)] = metaValue;
  }

  protected saveMetaSync(path: string): void {
    const pathLower = utils.translatePathMeta(path);
    // use an ES6 map for better perf
    const metaValue = this.metaMap[this.getMetaName(pathLower)];
    const metaPlain = Buffer.from(canonicalize(metaValue), 'utf-8');
    const metaCipher = utils.encryptWithKey(
      this.key,
      metaPlain,
    );
    try {
      // if 2 things do this at the same time we may get clobbering here
      // we need to ensure that our way of life here is not clobbered
      this.lowerFS.writeFileSync(
        utils.pathJoin(this.lowerFSRoot, pathLower),
        metaCipher
      );
    } catch (e) {
      if (e.code in errno) {
        throw new EncryptedFSError(
          errno[e.code],
          e.path,
          e.dest,
          e.syscall
        );
      } else {
        throw e;
      }
    }
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
