import type { PathLike } from 'fs';
import type { MappedMeta } from './types';

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
  constants,
  VirtualFSError
} from 'virtualfs';
import { Transfer } from 'threads';
import { EncryptedFSError, errno } from './EncryptedFSError';
import { WorkerManager } from './workers';
import * as utils from './utils';

/**
 * Asynchronous callback backup.
 */
const callbackUp = (err) => {
  if (err) throw err;
};

class EncryptedFS extends VirtualFS {
  public readonly cwdLower: string;
  public readonly blockSize: number;
  public readonly chunkSize: number;
  public readonly noatime: boolean;

  protected key: Buffer;
  protected fsLower: typeof fs;
  protected workerManager?: WorkerManager;
  protected fdMgr;

  // mapping metadata
  // and block values
  // protected metaMap: Map<string, MappedMeta> = new Map();

  // protected blockMap: Map<any, any> = new Map();

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
    this.fdMgr = fdMgr;
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

  public access (path: string, ...args: Array<any>): void {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = args[cbIndex] || callbackUp;
    super.exists(path, (exists) => {
      if (exists) {
        // @ts-ignore
        super.access(path, ...args);
      } else {
        this.loadMeta(path).then(
          () => {
            // @ts-ignore
            super.access(path, ...args);
          },
          callback
        );
      }
    });
  }

  public accessSync (path: string, mode: number = constants.F_OK): void {
    if (super.existsSync(path)) {
      super.accessSync(path, mode);
    } else {
      this.loadMetaSync(path);
      super.accessSync(path, mode);
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
          'lower',
          errno[e.code],
          e.path,
          e.dest,
          e.syscall
        );
      } else {
        throw e;
      }
    }
    const metaPlain = await this.decrypt(metaCipher);
    if (metaPlain == null) {
      throw new EncryptedFSError(
        'lower',
        {
          errno: -1,
          code: 'UNKNOWN',
          description: 'Metadata decryption failed'
        },
        pathLower,
      );
    }
    const metaValue = JSON.parse(metaPlain.toString('utf-8'));
    try {
      await new Promise<void>((resolve, reject) => {
        super.open(pathLower, 'w', (err, fdIndex) => {
          if (err != null) {
            reject(err);
          } else {
            const fd = this.fdMgr.getFd(fdIndex);
            const iNode = fd.getINode();
            iNode._metadata = new Stat({
              ...metaValue,
              ino: iNode._metadata.ino
            });
            super.close(fdIndex, () => {
              resolve();
            });
          }
        });
      });
    } catch (e) {
      if (e instanceof VirtualFSError) {
        throw new EncryptedFSError('lower', errno[e.code]);
      } else {
        throw e;
      }
    }
  }

  protected loadMetaSync (pathUpper: string): void {
    const pathLower = this.translatePathMeta(pathUpper);
    let metaCipher: Buffer;
    try {
      metaCipher = this.fsLower.readFileSync(pathLower);
    } catch (e) {
      if (e.code in errno) {
        throw new EncryptedFSError(
          'lower',
          errno[e.code],
          e.path,
          e.dest,
          e.syscall
        );
      } else {
        throw e;
      }
    }
    const metaPlain = this.decryptSync(metaCipher);
    if (metaPlain == null) {
      throw new EncryptedFSError(
        'lower',
        {
          errno: -1,
          code: 'UNKNOWN',
          description: 'Metadata decryption failed'
        },
        pathLower,
      );
    }
    const metaValue = JSON.parse(metaPlain.toString('utf-8'));
    try {
      const fdIndex = super.openSync(pathLower, 'w');
      const fd = this.fdMgr.getFd(fdIndex);
      const iNode = fd.getINode();
      // ensure we are preserving the ino which is dynamic in upperfs
      iNode._metadata = new Stat({
        ...metaValue,
        ino: iNode._metadata.ino
      });
      super.closeSync(fdIndex);
    } catch (e) {
      if (e instanceof VirtualFSError) {
        throw new EncryptedFSError('lower', errno[e.code]);
      } else {
        throw e;
      }
    }
  }

  // protected async saveMeta (pathUpper: PathLike): Promise<void> {
  //   const pathLower = this.translatePathMeta(pathUpper);
  //   const metaValue = this.metaMap.get(pathLower);
  //   if (!metaValue) {
  //     return;
  //   }
  //   const metaPlain = Buffer.from(canonicalize(metaValue) as string, 'utf-8');
  //   const metaCipher = await this.encrypt(metaPlain);
  //   try {
  //     await this.fsLower.promises.writeFile(pathLower, metaCipher);
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

  // protected saveMetaSync(pathUpper: string, metaValue): void {
  //   const pathLower = this.translatePathMeta(pathUpper);
  //   const metaPlain = Buffer.from(canonicalize(metaValue) as string, 'utf-8');
  //   const metaCipher = this.encryptSync(metaPlain);
  //   try {
  //     this.fsLower.writeFileSync(pathLower, metaCipher);
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
