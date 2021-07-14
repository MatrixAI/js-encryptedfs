import type { PathLike } from 'fs';

import fs from 'fs';
import pathNode from 'path';
import process from 'process';
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
  public readonly cwdLower: string;
  public readonly blockSize: number;
  public readonly chunkSize: number;
  public readonly noatime: boolean;

  protected key: Buffer;
  protected fsLower: typeof fs;
  protected workerManager?: WorkerManager;

  // these are closer to caches
  // than anything else
  // least recently used
  // and least frequently used

  protected metaMap: Map<any, any> = new Map();
  protected dataMap: Map<any, any> = new Map();

  constructor (
    key: Buffer,
    fsLower: typeof fs = fs,
    cwdLower: string = process.cwd(),
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
    this.fsLower = fsLower;
    this.cwdLower = pathNode.posix.resolve(cwdLower);
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

  // /**
  //  * It is not supported to change directories on EFS
  //  * The upper FS will always be at the root.
  //  * This can be supported in the future, but requires
  //  * changes to the path translation between upper and lower.
  //  */
  // public chdir (path: string): void {
  //   throw new EncryptedFSError(
  //     errno.ENOTSUP,
  //     path,
  //   );
  // }

  // public access (path: string, ...args: Array<any>): void {

  //   // this is asynchronous
  //   // this calls the access sync bind
  //   // with the cb index
  //   // but we really need to do things asynchronously

  // }

  // // this would have to load
  // // from the lower fs
  // // then run it
  // // have this re-export everything as usual
  // public accessSync (path: string, mode: number = constants.F_OK): void {
  //   if (super.existsSync(path)) {
  //     super.accessSync(path, mode);
  //   } else {

  //     // consider this to be equivalent to block mapping
  //     this.loadMetaSync(this.getMetaName(path));
  //     this.setMetadata(path);

  //     super.accessSync(path, mode);
  //   }
  // }

  // // this is a string
  // // that we are working against
  // // the access sync
  // // is performing synchronous multiple times
  // // so the whole thing is running in the background?
  // // well that only makes sense if its all in-memory ops anyway
  // // but here when we run readFileSync that's going to block the entire thread

  // // we need async and sync versions of this
  // // otherwise the sync version is going to do something weird

  // // sync vs async
  // // we will need an async version of this function

  // protected loadMetaSync (pathUpper: string): void {

  //   // suppose the path upper referred to some file
  //   // it's always in reference to root
  //   // right?
  //   // we don't have a CWD for upper

  //   const pathLower = utils.translatePathMeta(pathUpper);
  //   let metaCipher: Buffer;
  //   try {
  //     metaCipher = this.lowerFS.readFileSync(
  //       utils.pathJoin(this.lowerFSRoot, pathLower)
  //     );
  //   } catch (e) {
  //     if (e.code in errno) {
  //       throw new EncryptedFSError(
  //         errno[e.code],
  //         e.path,
  //         e.dest,
  //         e.syscall
  //       );
  //     } else {
  //       throw e;
  //     }
  //   }
  //   const metaPlain = utils.decryptWithKey(this.key, metaCipher);
  //   if (metaPlain == null) {
  //     throw new EncryptedFSError(
  //       {
  //         errno: -1,
  //         code: 'UNKNOWN',
  //         description: 'Metadata decryption failed'
  //       },
  //       pathLower,
  //     );
  //   }
  //   const metaValue = JSON.parse(metaPlain.toString('utf-8'));
  //   this.metaMap.set(
  //     this.getMetaName(pathLower),
  //     metaValue
  //   );
  // }

  // protected saveMetaSync(pathUpper: string): void {

  //   // this assumes that the path exists in the uppper fs?
  //   // and what if it doesn't exist?

  //   const pathLower = utils.translatePathMeta(pathUpper);
  //   // use an ES6 map for better perf
  //   // const metaValue = this.metaMap[this.getMetaName(pathLower)];

  //   const metaValue = this.metaMap.get(this.getMetaName(pathLower));

  //   if (!metaValue) {
  //     return;
  //   }

  //   const metaPlain = Buffer.from(canonicalize(metaValue), 'utf-8');
  //   const metaCipher = utils.encryptWithKey(
  //     this.key,
  //     metaPlain,
  //   );
  //   try {
  //     // if 2 things do this at the same time we may get clobbering here
  //     // we need to ensure that our way of life here is not clobbered
  //     this.lowerFS.writeFileSync(
  //       utils.pathJoin(this.lowerFSRoot, pathLower),
  //       metaCipher
  //     );
  //   } catch (e) {
  //     if (e.code in errno) {
  //       throw new EncryptedFSError(
  //         errno[e.code],
  //         e.path,
  //         e.dest,
  //         e.syscall
  //       );
  //     } else {
  //       throw e;
  //     }
  //   }
  // }

  // private getMetaName(path: string): string {
  //   const normalPath = pathNode.normalize(path);
  //   let dir = pathNode.dirname(normalPath);
  //   const base = pathNode.basename(normalPath);
  //   if (dir == '.') {
  //     dir = '';
  //   } else {
  //     dir += '/';
  //   }
  //   if (base == '.') {
  //     if (dir == '') {
  //       throw new EncryptedFSError(errno.ENOENT, path, null, 'getmeta');
  //     } else {
  //       return dir;
  //     }
  //   }
  //   let ret = pathNode.normalize(`${dir}${base}`);
  //   if (ret[0] == '/') {
  //     ret = ret.substring(1);
  //   }
  //   return ret;
  // }

  public translatePathData (pathUpper: PathLike): string {
    return this.translatePath(pathUpper)[0];
    // pathUpper = super._getPath(pathUpper) as string;
    // if (pathUpper === '') {
    //   // empty paths should stay empty
    //   return '';
    // }
    // const cwdUpper = super.getCwd();
    // pathUpper = pathNode.posix.resolve(cwdUpper, pathUpper);
    // // this array will always have parts because of cwdUpper
    // const partsUpper = pathUpper.split('/');
    // // remove the upper root part
    // // the lower fs has its own root from cwdLower
    // if (partsUpper[0] === '') {
    //   partsUpper.shift();
    // }
    // let partsLower;
    // if (partsUpper[0] === '') {
    //   // a part that is '' means it still at upper root
    //   // this can happen with a upper path that is just `/`
    //   // in this case, '' is preserved, so we use cwdLower
    //   partsLower = partsUpper;
    // } else {
    //   partsLower = partsUpper.map((p) => {
    //     return p + '.data';
    //   });
    // }
    // let pathLower = pathNode.posix.join(
    //   ...partsLower
    // );
    // pathLower = pathNode.posix.resolve(this.cwdLower, pathLower)
    // return pathLower;
  }

  public translatePathMeta (pathUpper: PathLike): string {
    return this.translatePath(pathUpper)[1];

    // pathUpper = super._getPath(pathUpper) as string;
    // if (pathUpper === '') {
    //   // empty paths should stay empty
    //   return '';
    // }
    // const cwdUpper = super.getCwd();
    // pathUpper = pathNode.posix.resolve(cwdUpper, pathUpper);
    // // this array will always have parts because of cwdUpper
    // const partsUpper = pathUpper.split('/');
    // // remove the upper root part
    // // the lower fs has its own root from cwdLower
    // if (partsUpper[0] === '') {
    //   partsUpper.shift();
    // }
    // let partsLower;
    // if (partsUpper[0] === '') {
    //   // a part that is '' means it still at upper root
    //   // this can happen with a upper path that is just `/`
    //   // in this case, '' is preserved, so we use cwdLower
    //   partsLower = partsUpper;
    // } else {
    //   partsLower = partsUpper.slice(0, partsUpper.length - 1).map((p) => {
    //     return p + '.data';
    //   });
    //   partsLower.push('.' + partsUpper[partsUpper.length - 1] + '.meta');
    // }
    // let pathLower = pathNode.posix.join(
    //   ...partsLower
    // );
    // pathLower = pathNode.posix.resolve(this.cwdLower, pathLower)
    // return pathLower;
  }


  public translatePath (pathUpper: PathLike): [string, string] {
    pathUpper = super._getPath(pathUpper) as string;
    if (pathUpper === '') {
      // empty paths should stay empty
      return ['', ''];
    }
    const cwdUpper = super.getCwd();
    pathUpper = pathNode.posix.resolve(cwdUpper, pathUpper);
    // this array will always have parts because of cwdUpper
    const partsUpper = pathUpper.split('/');
    // remove the upper root part
    // the lower fs has its own root from cwdLower
    if (partsUpper[0] === '') {
      partsUpper.shift();
    }
    let pathLowerData;
    let pathLowerMeta;
    if (partsUpper[0] === '') {
      // a part that is '' means it still at upper root
      // this can happen with a upper path that is just `/`
      // in this case, '' is preserved, so we use cwdLower
      // partsLower = partsUpper;
      pathLowerData = this.cwdLower;
      pathLowerMeta = this.cwdLower;
    } else {
      const partsLower = partsUpper.slice(0, partsUpper.length - 1).map((p) => {
        return p + '.data';
      });
      const partsLowerLastData = partsUpper[partsUpper.length - 1] + '.data';
      const partsLowerLastMeta = '.' + partsUpper[partsUpper.length - 1] + '.meta';
      const pathLower = pathNode.posix.join(...partsLower);
      pathLowerData = pathNode.posix.resolve(
        this.cwdLower,
        pathLower,
        partsLowerLastData
      );
      pathLowerMeta = pathNode.posix.resolve(
        this.cwdLower,
        pathLower,
        partsLowerLastMeta
      );
    }
    return [pathLowerData, pathLowerMeta];
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
