import type { PathLike } from 'fs';
import type { POJO } from './types';

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
import { Transfer } from 'threads';
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

  protected metaMap: Map<any, POJO> = new Map();
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


  // needs to be asynchronous
  // which means even meta loading and saving has to be used
  public access (path: string, ...args: Array<any>): void {

    // this is asynchronous
    // this calls the access sync bind
    // with the cb index
    // but we really need to do things asynchronously

  }

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

  // also the enryption/decryption of this should use workers when available

  protected loadMetaSync (pathUpper: string): void {
    const pathLower = this.translatePathMeta(pathUpper);
    let metaCipher: Buffer;
    try {
      metaCipher = this.fsLower.readFileSync(pathLower);
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
    this.metaMap.set(pathLower, metaValue);
  }

  protected saveMetaSync(pathUpper: string): void {
    const pathLower = this.translatePathMeta(pathUpper);
    const metaValue = this.metaMap.get(pathLower);
    if (!metaValue) {
      return;
    }
    const metaPlain = Buffer.from(canonicalize(metaValue) as string, 'utf-8');
    const metaCipher = utils.encryptWithKey(
      this.key,
      metaPlain,
    );
    try {
      this.fsLower.writeFileSync(pathLower, metaCipher);
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

  protected async loadMeta(pathUpper: PathLike): Promise<void> {
    const pathLower = this.translatePathMeta(pathUpper);
    let metaCipher: Buffer;
    try {
      metaCipher = await this.fsLower.promises.readFile(pathLower);
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
    this.metaMap.set(pathLower, metaValue);
  }

  protected async saveMeta (pathUpper: PathLike): Promise<void> {
    const pathLower = this.translatePathMeta(pathUpper);
    const metaValue = this.metaMap.get(pathLower);
    if (!metaValue) {
      return;
    }
    const metaPlain = Buffer.from(canonicalize(metaValue) as string, 'utf-8');
    const metaCipher = utils.encryptWithKey(
      this.key,
      metaPlain,
    );
    try {
      await this.fsLower.promises.writeFile(pathLower, metaCipher);
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

  public translatePathData (pathUpper: PathLike): string {
    return this.translatePath(pathUpper)[0];
  }

  public translatePathMeta (pathUpper: PathLike): string {
    return this.translatePath(pathUpper)[1];
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

  /**
   * Encrypt plaintext to ciphertext
   * When the WorkerManager is available, it will use it
   * However when it is not available, the encryption will use the main thread CPU
   * This is a CPU-intensive operation, not IO-intensive
   */
  protected async encrypt(plainText: Buffer): Promise<Buffer> {
    let cipherText: Buffer;
    if (this.workerManager) {
      cipherText = await this.workerManager.call(
        async w => {
          const [cipherBuf, cipherOffset, cipherLength]= await w.encryptWithKey(
            Transfer(this.key.buffer),
            this.key.byteOffset,
            this.key.byteLength,
            // @ts-ignore
            Transfer(plainText.buffer),
            plainText.byteOffset,
            plainText.byteLength
          );
          return Buffer.from(cipherBuf, cipherOffset, cipherLength);
        }
      );
    } else {
      cipherText = utils.encryptWithKey(this.key, plainText);
    }
    return cipherText;
  }

  protected encryptSync(plainText: Buffer): Buffer {
    return utils.encryptWithKey(this.key, plainText);
  }

  /**
   * Decrypt ciphertext to plaintext
   * When the WorkerManager is available, it will use it
   * However when it is not available, the decryption will use the main thread CPU
   * This is a CPU-intensive operation, not IO-intensive
   */
  protected async decrypt(cipherText: Buffer): Promise<Buffer|undefined> {
    let plainText: Buffer | undefined;
    if (this.workerManager) {
      plainText = await this.workerManager.call(
        async w => {
          const decrypted = await w.decryptWithKey(
            Transfer(this.key.buffer),
            this.key.byteOffset,
            this.key.byteLength,
            // @ts-ignore
            Transfer(cipherText.buffer),
            cipherText.byteOffset,
            cipherText.byteLength
          );
          if (decrypted != null) {
            return Buffer.from(decrypted[0], decrypted[1], decrypted[2]);
          } else {
            return;
          }
        }
      );
    } else {
      plainText = utils.decryptWithKey(this.key, cipherText);
    }
    return plainText;
  }

  protected decryptSync(cipherText: Buffer): Buffer | undefined {
    return utils.decryptWithKey(this.key, cipherText);
  }

}

export default EncryptedFS;
