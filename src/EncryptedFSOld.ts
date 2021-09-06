import type fs from 'fs';
import type { PathLike } from 'fs';
import type { FileDescriptor, File, INode } from 'virtualfs';
import type { BlockMeta, POJO, EncryptedMetadata } from './types';

import pathNode from 'path';
import process from 'process';
import callbackify from 'util-callbackify';
import {
  VirtualFS,
  Stat,
  INodeManager,
  DeviceManager,
  constants,
  VirtualFSError,
  FileDescriptorManager,
  DEFAULT_FILE_PERM,
  DEFAULT_DIRECTORY_PERM,
  DEFAULT_SYMLINK_PERM,
} from 'virtualfs';

import { Transfer } from 'threads';
import { EncryptedFSError, errno } from './EncryptedFSError';
import { WorkerManager } from './workers';
import * as utils from './utils';
import EncryptedStat from './EncryptedStat';

public async mmap(
  length: number,
  flags: number,
  fdIndex: FdIndex,
  offset?: number,
): Promise<Buffer>;
public async mmap(
  length: number,
  flags: number,
  fdIndex: FdIndex,
  callback: Callback<[Buffer]>,
): Promise<void>;
public async mmap(
  length: number,
  flags: number,
  fdIndex: FdIndex,
  offset: number,
  callback: Callback<[Buffer]>,
): Promise<void>;
public async mmap(
  length: number,
  flags: number,
  fdIndex: FdIndex,
  offsetOrCallback: number | Callback<[Buffer]> = 0,
  callback?: Callback<[Buffer]>
): Promise<Buffer | void> {
  const offset =
    typeof offsetOrCallback !== 'function' ? offsetOrCallback : 0;
  callback =
    typeof offsetOrCallback === 'function' ? offsetOrCallback : callback;
  return maybeCallback(async () => {
    if (length < 1 || offset < 0) {
      throw new EncryptedFSError(errno.EINVAL, `mmap '${fdIndex}'`);
    }
    const fd = this._fdMgr.getFd(fdIndex);
    if (!fd) {
      throw new EncryptedFSError(errno.EBADF, `mmap '${fdIndex}'`);
    }
    const access = fd.flags & vfs.constants.O_ACCMODE;
    if (access === vfs.constants.O_WRONLY) {
      throw new EncryptedFSError(errno.EACCES, `mmap '${fdIndex}'`);
    }
    const iNode = fd.ino;
    let iNodeData = Buffer.alloc(0);
    await this._iNodeMgr.transact(async (tran) => {
      const iNodeType = (await this._iNodeMgr.get(tran, iNode))?.type;
      if (!(iNodeType === 'File')) {
        throw new EncryptedFSError(errno.ENODEV, `mmap '${fdIndex}'`);
      }
      for await (const block of this._iNodeMgr.fileGetBlocks(tran, iNode, this._blkSize)) {
        iNodeData = Buffer.concat([iNodeData, block]);
      }
    }, [iNode]);
    switch (flags) {
    case vfs.constants.MAP_PRIVATE:
      return Buffer.from(iNodeData.slice(offset, offset + length));
    case vfs.constants.MAP_SHARED:
      if (access !== vfs.constants.O_RDWR) {
        throw new EncryptedFSError(errno.EACCES, `mmap '${fdIndex}'`);
      }
      let a = await permaProxy(iNode, '_data');
      console.log(a);
      a = a.slice(offset, offset + length);
      return a;
    default:
      throw new EncryptedFSError(errno.EINVAL, `mmap '${fdIndex}'`);
    }
  }, callback);
}

/**
 * Asynchronous callback backup.
 */
const callbackUp = (err) => {
  if (err) throw err;
};

class EncryptedFS {
  public readonly blockSizePlain: number;
  public readonly blockSizeCipher: number;
  protected key: Buffer;
  protected upper: {
    fs: VirtualFS;
    devMgr: DeviceManager;
    iNodeMgr: INodeManager;
    fdMgr: FileDescriptorManager;
  };
  protected lower: {
    fs: typeof fs;
    dir: string;
  };
  protected workerManager?: WorkerManager;
  protected fdMap: Map<
    number,
    {
      dataFd: number;
      metaFd: number;
    }
  > = new Map();
  protected blockMap: WeakMap<INode, BlockMeta> = new WeakMap();

  // protected metaMap: Map<string, MappedMeta> = new Map();

  constructor(
    key: Buffer,
    dir: string = process.cwd(),
    fsLower: typeof fs = require('fs'),
    umask: number = 0o022,
    blockSizePlain: number = 4096,
    devMgr: DeviceManager = new DeviceManager(),
    iNodeMgr: INodeManager = new INodeManager(devMgr),
    fdMgr: FileDescriptorManager = new FileDescriptorManager(iNodeMgr),
  ) {
    if (![16, 24, 32].includes(key.byteLength)) {
      throw new RangeError('AES only allows 128, 192, 256 bit sizes');
    }
    this.key = key;
    this.blockSizePlain = blockSizePlain;
    this.blockSizeCipher = utils.ivSize + utils.authTagSize + blockSizePlain;
    this.upper = {
      fs: new VirtualFS(umask, null, devMgr, iNodeMgr, fdMgr),
      devMgr,
      iNodeMgr,
      fdMgr,
    };
    this.lower = {
      fs: fsLower,
      dir: utils.pathResolve(dir),
    };
  }

  public setWorkerManager(workerManager: WorkerManager) {
    this.workerManager = workerManager;
  }

  public unsetWorkerManager() {
    delete this.workerManager;
  }

  public getUmask(): number {
    return this.upper.fs.getUmask();
  }

  public setUmask(umask: number): void {
    return this.upper.fs.setUmask(umask);
  }

  public getUid(): number {
    return this.upper.fs.getUid();
  }

  public setUid(uid: number): void {
    return this.upper.fs.setUid(uid);
  }

  public getGid(): number {
    return this.upper.fs.getGid();
  }

  public setGid(gid: number): void {
    return this.upper.fs.setGid(gid);
  }

  // this is meant to be recursive now
  // but the version is older
  // and you would get the metadata
  // as if the whole file had it
  // but when we create new Stat
  // it asks for hte props
  public mkdirpSync(
    path: PathLike,
    mode: number = DEFAULT_DIRECTORY_PERM,
  ): void {
    // here we are going to have to create directories
    // one at a time
    // but in doing so
    // we have to
    // see if the directories are created lower level
    // and also create them on the upperfs too
    // since it has to be on the lowerfs
    // before the upper fs
    // but at the same time...
    // we would need
    // if the original metadata exists
    // and the mode is not here
    // then means we can just K
    // load it like and use this.upper.fs._checkPermissions(access, stat)
    // note that it checks against a stat object
  }

  public openSync(
    path: PathLike,
    flags: string | number = 'r',
    mode?: number,
  ): number {
    const pathUpper = this.upper.fs._getPath(path);
    const [pathLowerData, pathLowerMeta] = this.translatePath(path);
    let fdIndexLowerData, fdIndexLowerMeta;
    let fdIndexUpper;
    let flags_: number;
    if (typeof flags === 'string') {
      flags_ = utils.parseOpenFlags(flags);
    } else {
      flags_ = flags;
    }
    try {
      fdIndexLowerData = this.lower.fs.openSync(pathLowerData, flags_, mode);
      fdIndexLowerMeta = this.lower.fs.openSync(
        pathLowerMeta,
        constants.O_RDWR | constants.O_CREAT,
        mode,
      );

      // TODO:
      // change to internal navigation function
      // that loads to upperfs the directories first
      // by traversing the lower directories
      // then only then open the lowerfs file
      // this allows us to use the metadata as well
      // as well do directory mapping

      this.upper.fs.mkdirpSync(pathNode.posix.dirname(pathUpper));
      fdIndexUpper = this.upper.fs.openSync(
        pathUpper,
        flags_ | constants.O_CREAT,
        mode,
      );
      const fdUpper = this.upper.fs._fdMgr.getFd(fdIndexUpper)!;
      const iNodeUpper = fdUpper.getINode();
      let metadata = this.readMetaSync(fdIndexLowerMeta);
      if (metadata == null) {
        metadata = { ...iNodeUpper._metadata };
        if (iNodeUpper._metadata.isFile()) {
          metadata.blksize = this.blockSizePlain;
          metadata.blocks = 0;
        }
      } else {
        metadata.ino = iNodeUpper._metadata.ino;
        metadata.nlink = iNodeUpper._metadata.nlink;
      }
      iNodeUpper._metadata = new EncryptedStat(metadata);
    } catch (e) {
      if (fdIndexLowerData != null) {
        this.lower.fs.closeSync(fdIndexLowerData);
      }
      if (fdIndexLowerMeta != null) {
        this.lower.fs.closeSync(fdIndexLowerMeta);
      }
      if (fdIndexUpper != null) {
        this.upper.fs.closeSync(fdIndexUpper);
      }
      throw e;
    }

    this.fdMap.set(fdIndexUpper, {
      dataFd: fdIndexLowerData,
      metaFd: fdIndexLowerMeta,
    });
    return fdIndexUpper;
  }

  public closeSync(fdIndexUpper: number): void {
    const fds = this.fdMap.get(fdIndexUpper);
    if (fds == null) {
      // EBADF
      throw new Error();
    }
    try {
      this.lower.fs.closeSync(fds.dataFd);
      this.lower.fs.closeSync(fds.metaFd);
      this.upper.fs.closeSync(fdIndexUpper);
    } catch (e) {
      throw e;
    }
  }

  protected getBlockMeta(iNode: INode): BlockMeta {
    let blockMeta = this.blockMap.get(iNode);
    if (blockMeta == null) {
      blockMeta = {
        loaded: new Set(),
      };
      this.blockMap.set(iNode, blockMeta);
    }
    return blockMeta;
  }

  protected setBlockMeta(iNode: INode, blockMeta: BlockMeta): void {
    this.blockMap.set(iNode, blockMeta);
  }

  public readSync(
    fdIndexUpper: number,
    buffer: Buffer | Uint8Array,
    offset: number = 0,
    length: number = buffer.byteLength,
    position: number | null = null,
  ): number {
    const fds = this.fdMap.get(fdIndexUpper);
    const fdUpper = this.upper.fs._fdMgr.getFd(fdIndexUpper);
    if (fds == null || fdUpper == null) {
      throw new EncryptedFSError(
        new VirtualFSError(errno.EBADF, null, null, 'read'),
      );
    }
    if (position != null && position < 0) {
      throw new EncryptedFSError(
        new VirtualFSError(errno.EINVAL, null, null, 'read'),
      );
    }
    const iNodeUpper = fdUpper.getINode();
    const metadata = iNodeUpper.getMetadata();
    // only files are supported to be read
    if (metadata.isDirectory()) {
      throw new EncryptedFSError(
        new VirtualFSError(errno.EISDIR, null, null, 'read'),
      );
    } else if (!metadata.isFile()) {
      throw new EncryptedFSError(
        new VirtualFSError(errno.EINVAL, null, null, 'read'),
      );
    }
    if (offset < 0 || offset > buffer.byteLength) {
      throw new RangeError('Offset is out of bounds');
    }
    if (length < 0 || length > buffer.byteLength) {
      throw new RangeError('Length extends beyond buffer');
    }
    let dataPos: number;
    if (position != null) {
      dataPos = position;
    } else {
      dataPos = fdUpper.getPos();
    }
    let dataUpper = (iNodeUpper as File).getData();
    // the true desired length is the smaller of the length or
    // the available bytes to read into for the input buffer
    const dataLength = Math.min(length, buffer.byteLength - offset);
    const blockMeta = this.getBlockMeta(iNodeUpper);
    const plainPosStart = dataPos;
    const plainBlockIndexStart = utils.blockIndexStart(
      this.blockSizePlain,
      plainPosStart,
    );
    const plainBlockOffset = utils.blockOffset(
      this.blockSizePlain,
      plainPosStart,
    );
    const plainBlockLength = utils.blockLength(
      this.blockSizePlain,
      plainBlockOffset,
      dataLength,
    );
    const plainBlockIndexEnd = utils.blockIndexEnd(
      plainBlockIndexStart,
      plainBlockLength,
    );
    const blockRanges = utils.blockRanges(
      blockMeta.loaded,
      plainBlockIndexStart,
      plainBlockIndexEnd,
    );
    for (const [blockIndexStart, blockIndexEnd] of blockRanges) {
      const blockLength = blockIndexEnd - blockIndexStart + 1;
      const cipherPosStart = utils.blockPositionStart(
        this.blockSizeCipher,
        blockIndexStart,
      );
      const cipherSegment = Buffer.allocUnsafe(
        blockLength * this.blockSizeCipher,
      );
      let cipherBytesRead: number;
      try {
        cipherBytesRead = this.lower.fs.readSync(
          fds.dataFd,
          cipherSegment,
          0,
          cipherSegment.byteLength,
          cipherPosStart,
        );
      } catch (e) {
        throw new EncryptedFSError(e);
      }
      if (cipherBytesRead === 0) {
        // there's nothing more to read
        break;
      }
      if (cipherBytesRead % this.blockSizeCipher !== 0) {
        throw new EncryptedFSError(
          undefined,
          'Byte length read from lower FS is not a multiple of the cipher block size',
        );
      }
      const blockLengthRead = utils.blockLength(
        this.blockSizeCipher,
        0,
        cipherBytesRead,
      );
      const plainSegment = this.cipherToPlainSegmentSync(
        cipherSegment,
        blockLengthRead,
      );
      const plainPosStart = utils.blockPositionStart(
        this.blockSizePlain,
        blockIndexStart,
      );
      // resize the dataUpper
      if (plainPosStart > dataUpper.byteLength) {
        dataUpper = Buffer.concat([
          dataUpper,
          Buffer.alloc(plainPosStart - dataUpper.byteLength),
          Buffer.allocUnsafe(plainSegment.byteLength),
        ]);
      } else if (plainPosStart <= dataUpper.byteLength) {
        const overwrittenLength = dataUpper.byteLength - plainPosStart;
        const extendedLength = plainSegment.byteLength - overwrittenLength;
        if (extendedLength > 0) {
          dataUpper = Buffer.concat([
            dataUpper,
            Buffer.allocUnsafe(extendedLength),
          ]);
        }
      }
      // copy into the dataUpper
      plainSegment.copy(dataUpper, plainPosStart);
      // reset the inode's buffer (if the dataBuffer was newly constructed)
      (iNodeUpper as File).setData(dataUpper);
      // update the loaded blocks
      for (let i = 0; i < blockLengthRead; ++i) {
        blockMeta.loaded.add(blockIndexStart + i);
      }
    }
    let plainBytesRead: number;
    try {
      plainBytesRead = this.upper.fs.readSync(
        fdIndexUpper,
        buffer,
        offset,
        length,
        position,
      );
    } catch (e) {
      throw new EncryptedFSError(e);
    }
    this.writeMetaSync(fds.metaFd, { ...metadata });
    return plainBytesRead;
  }

  public writeSync(
    fdIndexUpper: number,
    data: Buffer | Uint8Array | string,
    offsetOrPos?: number,
    lengthOrEncoding?: number | string,
    position: number | null = null,
  ): number {
    const fds = this.fdMap.get(fdIndexUpper);
    const fdUpper = this.upper.fs._fdMgr.getFd(fdIndexUpper);
    if (fds == null || fdUpper == null) {
      throw new EncryptedFSError(
        new VirtualFSError(errno.EBADF, null, null, 'write'),
      );
    }
    if (position != null && position < 0) {
      throw new EncryptedFSError(
        new VirtualFSError(errno.EINVAL, null, null, 'write'),
      );
    }
    const flags = fdUpper.getFlags();
    if (!(flags & (constants.O_WRONLY | constants.O_RDWR))) {
      throw new EncryptedFSError(
        new VirtualFSError(errno.EBADF, null, null, 'write'),
      );
    }

    // IF the fd is being appended
    // tha is the fd was under append mode
    // the current position does not matter here
    // and we are always writing to the end
    // so the dataPos has to be set to the very end in that case
    // in that case no block loading make sense either

    let buffer: Buffer;
    if (typeof data === 'string') {
      position = typeof offsetOrPos === 'number' ? offsetOrPos : null;
      lengthOrEncoding =
        typeof lengthOrEncoding === 'string' ? lengthOrEncoding : 'utf8';
      buffer = this.upper.fs._getBuffer(data, lengthOrEncoding);
    } else {
      offsetOrPos = typeof offsetOrPos === 'number' ? offsetOrPos : 0;
      if (offsetOrPos < 0 || offsetOrPos > data.length) {
        throw new RangeError('Offset is out of bounds');
      }
      lengthOrEncoding =
        typeof lengthOrEncoding === 'number' ? lengthOrEncoding : data.length;
      if (lengthOrEncoding < 0 || lengthOrEncoding > data.length) {
        throw new RangeError('Length is out of bounds');
      }
      buffer = this.upper.fs
        ._getBuffer(data)
        .slice(offsetOrPos, offsetOrPos + lengthOrEncoding);
    }

    // note that the offsetOrPos

    // now we have the buffer
    // that needs to be written
    // how do we know the buffer

    const iNodeUpper = fdUpper.getINode();
    const metadata = iNodeUpper.getMetadata();
    let dataPos: number;
    if (position != null) {
      dataPos = position;
    } else {
      dataPos = fdUpper.getPos();
    }
    let dataUpper = (iNodeUpper as File).getData();
    const dataLength = buffer.byteLength;
    const blockMeta = this.getBlockMeta(iNodeUpper);
    const plainPosStart = dataPos;

    // figuring out which plain blocks are we affecting

    const plainBlockIndexStart = utils.blockIndexStart(
      this.blockSizePlain,
      plainPosStart,
    );
    const plainBlockOffset = utils.blockOffset(
      this.blockSizePlain,
      plainPosStart,
    );
    const plainBlockLength = utils.blockLength(
      this.blockSizePlain,
      plainBlockOffset,
      dataLength,
    );
    const plainBlockIndexEnd = utils.blockIndexEnd(
      plainBlockIndexStart,
      plainBlockLength,
    );
    const blockRanges = utils.blockRanges(
      blockMeta.loaded,
      plainBlockIndexStart,
      plainBlockIndexEnd,
    );

    // there may be multiple blocks to load here
    // because the writing might affect multiple sections
    // technically we only need to load the beginning
    // and the last block
    // and only if these blocks are offset
    // there's no need to LOAD all the blocks
    // cause we are going to overwriting them anyway
    // so that's an optimisation that we have to do
    // in that case the block range function
    // should only give us the first block ONLY
    // and last block ONLY if necessary
    // but the below

    for (const [blockIndexStart, blockIndexEnd] of blockRanges) {
      const blockLength = blockIndexEnd - blockIndexStart + 1;
      const cipherPosStart = utils.blockPositionStart(
        this.blockSizeCipher,
        blockIndexStart,
      );
      const cipherSegment = Buffer.allocUnsafe(
        blockLength * this.blockSizeCipher,
      );
      let cipherBytesRead: number;
      try {
        cipherBytesRead = this.lower.fs.readSync(
          fds.dataFd,
          cipherSegment,
          0,
          cipherSegment.byteLength,
          cipherPosStart,
        );
      } catch (e) {
        throw new EncryptedFSError(e);
      }
      if (cipherBytesRead === 0) {
        // there's nothing more to read
        break;
      }
      if (cipherBytesRead % this.blockSizeCipher !== 0) {
        throw new EncryptedFSError(
          undefined,
          'Byte length read from lower FS is not a multiple of the cipher block size',
        );
      }
      const blockLengthRead = utils.blockLength(
        this.blockSizeCipher,
        0,
        cipherBytesRead,
      );
      const plainSegment = Buffer.allocUnsafe(
        blockLengthRead * this.blockSizePlain,
      );

      // what if we decrypted each cipherblock
      // and then also "loaded it"
      // but the loadin is weird here

      // decrypt each cipher block from the cipherSegment
      // and copy them into the plainSegment
      for (let i = 0, j = i * this.blockSizeCipher; i < blockLengthRead; ++i) {
        const cipherBlock = cipherSegment.slice(j, j + this.blockSizeCipher);
        const plainBlock = this.decryptSync(cipherBlock);
        if (plainBlock == null) {
          throw new EncryptedFSError(undefined, 'Block decryption failed');
        }
        plainBlock.copy(plainSegment, i * this.blockSizePlain);
      }
      const plainPosStart = utils.blockPositionStart(
        this.blockSizePlain,
        blockIndexStart,
      );
      // resize the dataUpper
      if (plainPosStart > dataUpper.byteLength) {
        dataUpper = Buffer.concat([
          dataUpper,
          Buffer.alloc(plainPosStart - dataUpper.byteLength),
          Buffer.allocUnsafe(plainSegment.byteLength),
        ]);
      } else if (plainPosStart <= dataUpper.byteLength) {
        const overwrittenLength = dataUpper.byteLength - plainPosStart;
        const extendedLength = plainSegment.byteLength - overwrittenLength;
        if (extendedLength > 0) {
          dataUpper = Buffer.concat([
            dataUpper,
            Buffer.allocUnsafe(extendedLength),
          ]);
        }
      }

      // i'm trying to copy into the data buffer ehere
      // but the data buffer may be the same data buffer
      // or a completely new data buffer... we don't know here
      // the problem is that
      // this is "loading blocks upper"
      // and then attempting to write?

      // copy into the dataUpper
      plainSegment.copy(dataUpper, plainPosStart);
      // reset the inode's buffer (if the dataBuffer was newly constructed)
      (iNodeUpper as File).setData(dataUpper);
      // update the loaded blocks
      for (let i = 0; i < blockLengthRead; ++i) {
        blockMeta.loaded.add(blockIndexStart + i);
      }
    }

    // the above "loads relevant blocks" into the upper fs
    // without actually reading any data
    // now we can perform a a write
    // but to do so
    // we must "construct the cipherSegment"
    // so to do this
    // we must do the equivalent of the write
    // but when we do this
    // during this write
    // we are writing the buffer in...
    // OH and shit the stuff changes if the
    // flags are O_APPEND
    // it's possible that
    // the append may be done
    // if the fd was opened with append
    // the exact way is different again

    // plainSegment
    // HOW DO I COPY the `buffer`
    // ONTO the plainSegment now?
    // we need the dataUpper
    // and write it into it

    // 1. write the input buffer INTO the dataUpper (the data upper has been loaded)
    // 2. the data upper has be a copy
    // 3. slice from the data upper to get the plainSegment
    // 4. encrypt the plainSegment into the cipherSegment

    // this is copying into it

    // but this assumes the dataUpper has enough blocks
    // it could be... since we had to "load it"
    // but there may actually not be enough blocks above

    // here we have to deal with:
    // appending
    // writing ahead of the current data
    // writing behind the current data but with length extended
    // writing directly into the dataUpper
    // dealing with the fact that the dataUpper is not a copy

    // this
    const dataUpperCopy = Buffer.from(dataUpper);

    buffer.copy(dataUpperCopy, plainPosStart);

    const plainPosEnd = plainPosStart + dataLength;

    const plainSegment = dataUpperCopy.slice(plainPosStart, plainPosEnd + 1);

    // BETTER idea
    // you creat a buffer of the right size including append mode
    // you copy the dataUpper into it
    // and you also copy your input buffer into it
    // now you get a proper plainSegment
    // then finally the plainSegment becomes a cipherSegment
    // and you know the drill

    // this copies from one segment to another
    // we have to allocate accordingly
    const cipherSegment = Buffer.allocUnsafe(
      plainBlockLength * this.blockSizeCipher,
    );

    // encrypt plainSegment into cipherSegment
    for (let i = 0, j = i * this.blockSizePlain; i < plainBlockLength; ++i) {
      const plainBlock = plainSegment.slice(j, j + this.blockSizePlain);
      const cipherBlock = this.encryptSync(plainBlock);
      cipherBlock.copy(cipherSegment, i * this.blockSizeCipher);
    }

    const cipherPosStart = utils.blockPositionStart(
      this.blockSizeCipher,
      plainBlockIndexStart,
    );

    // this now gives us the right blocks

    try {
      this.lower.fs.writeSync(
        fds.dataFd,
        cipherSegment,
        0,
        cipherSegment.byteLength,
        cipherPosStart,
      );
    } catch (e) {
      throw new EncryptedFSError(e);
    }

    let plainBytesWritten: number;
    try {
      plainBytesWritten = this.upper.fs.writeSync(
        fdIndexUpper,
        buffer,
        0,
        buffer.byteLength,
        position,
      );
    } catch (e) {
      throw new EncryptedFSError(e);
    }
    this.writeMetaSync(fds.metaFd, { ...metadata });
    return plainBytesWritten;
  }

  // public access (path: PathLike, ...args: Array<any>): void {
  //   let cbIndex = args.findIndex((arg) => typeof arg === 'function');
  //   const callback = args[cbIndex] || callbackUp;
  //   super.exists(path, (exists) => {
  //     if (exists) {
  //       super.access(path, ...args);
  //     } else {
  //       const loadMeta = callbackify(this.loadMeta).bind(this);
  //       loadMeta(path, (e) => {
  //         if (!e) {
  //           super.access(path, ...args);
  //         } else {
  //           callback(e);
  //         }
  //       });
  //     }
  //   });
  // }

  // public accessSync (path: PathLike, mode: number = constants.F_OK): void {
  //   if (super.existsSync(path)) {
  //     super.accessSync(path, mode);
  //   } else {
  //     this.loadMetaSync(path);
  //     super.accessSync(path, mode);
  //   }
  // }

  // public existsSync(path: PathLike): boolean {
  //   if (super.existsSync(path)) {
  //     return true;
  //   } else {
  //     try {
  //       this.loadMetaSync(path);
  //     } catch (e) {
  //       return false;
  //     }
  //     return super.existsSync(path);
  //   }
  // }

  // protected async loadMeta(path: PathLike): Promise<void> {
  //   const pathUpper = super._getPath(path);
  //   const pathLower = this.translatePathMeta(pathUpper);
  //   let metaCipher: Buffer;
  //   try {
  //     metaCipher = await this.fsLower.promises.readFile(pathLower);
  //   } catch (e) {
  //     if (e.code in errno) {
  //       throw new EncryptedFSError(
  //         'lower',
  //         errno[e.code],
  //         e.path,
  //         e.dest,
  //         e.syscall
  //       );
  //     } else {
  //       throw e;
  //     }
  //   }
  //   const metaPlain = await this.decrypt(metaCipher);
  //   if (metaPlain == null) {
  //     throw new EncryptedFSError(
  //       'lower',
  //       {
  //         errno: -1,
  //         code: 'UNKNOWN',
  //         description: 'Metadata decryption failed'
  //       },
  //       pathLower,
  //     );
  //   }
  //   const metaValue = JSON.parse(metaPlain.toString('utf-8'));
  //   try {
  //     await new Promise<void>((resolve, reject) => {
  //       super.mkdirp(pathNode.posix.dirname(pathUpper), (e) => {
  //         if (e != null) {
  //           reject(e);
  //         } else {
  //           super.open(pathUpper, 'a', (e, fdIndex) => {
  //             if (e != null) {
  //               reject(e);
  //             } else {
  //               const fd = this._fdMgr.getFd(fdIndex);
  //               const iNode = fd.getINode();
  //               iNode._metadata = new Stat({
  //                 ...metaValue,
  //                 ino: iNode._metadata.ino
  //               });
  //               super.close(fdIndex, () => {
  //                 resolve();
  //               });
  //             }
  //           });
  //         }
  //       });
  //     });
  //   } catch (e) {
  //     if (e instanceof VirtualFSError) {
  //       throw new EncryptedFSError('lower', errno[e.code]);
  //     } else {
  //       throw e;
  //     }
  //   }
  // }

  protected readMetaSync(
    fdIndexLowerMeta: number,
  ): EncryptedMetadata | undefined {
    let metaCipher: Buffer;
    try {
      metaCipher = this.lower.fs.readFileSync(fdIndexLowerMeta);
    } catch (e) {
      if (e.syscall === 'open' && e.code === 'ENOENT') {
        // meta file does not exist
        return;
      } else {
        throw new EncryptedFSError(e);
      }
    }
    const metaPlain = this.decryptSync(metaCipher);
    if (metaPlain == null) {
      throw new EncryptedFSError(undefined, 'Metadata decryption failed');
    }
    const metaValue = JSON.parse(metaPlain.toString('utf-8'));
    return metaValue;
  }

  protected writeMetaSync(
    fdIndexLowerMeta: number,
    metadata: EncryptedMetadata,
  ): void {
    const metaPlain = Buffer.from(JSON.stringify(metadata), 'utf-8');
    const metaCipher = this.encryptSync(metaPlain);
    try {
      this.lower.fs.writeFileSync(fdIndexLowerMeta, metaCipher);
    } catch (e) {
      throw new EncryptedFSError(e);
    }
  }

  /**
   * Encrypts a plain segment into a cipher segment
   * A segment is a contiguous buffer of blocks
   */
  protected plainToCipherSegmentSync(
    plainSegment: Buffer,
    blockLength: number,
  ): Buffer {
    return utils.plainToCipherSegment(
      this.key,
      plainSegment,
      blockLength,
      this.blockSizePlain,
      this.blockSizeCipher,
    );
  }

  /**
   * Decrypts a cipher segment into a plain segment
   * A segment is a contiguous buffer of blocks
   */
  protected cipherToPlainSegmentSync(
    cipherSegment: Buffer,
    blockLength: number,
  ): Buffer {
    const plainSegment = utils.cipherToPlainSegment(
      this.key,
      cipherSegment,
      blockLength,
      this.blockSizePlain,
      this.blockSizeCipher,
    );
    if (plainSegment == null) {
      throw new EncryptedFSError(undefined, 'Block decryption failed');
    }
    return plainSegment;
  }

  public translatePathData(path: PathLike): string {
    return this.translatePath(path)[0];
  }

  public translatePathMeta(path: PathLike): string {
    return this.translatePath(path)[1];
  }

  public translatePath(path: PathLike): [string, string] {
    let pathUpper = this.upper.fs._getPath(path);
    if (pathUpper === '') {
      // empty paths should stay empty
      return ['', ''];
    }
    const cwdUpper = this.upper.fs.getCwd();
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
      pathLowerData = this.lower.dir;
      pathLowerMeta = this.lower.dir;
    } else {
      const partsLower = partsUpper.slice(0, partsUpper.length - 1).map((p) => {
        return p + '.data';
      });
      const partsLowerLastData = partsUpper[partsUpper.length - 1] + '.data';
      const partsLowerLastMeta =
        '.' + partsUpper[partsUpper.length - 1] + '.meta';
      const pathLower = pathNode.posix.join(...partsLower);
      pathLowerData = pathNode.posix.resolve(
        this.lower.dir,
        pathLower,
        partsLowerLastData,
      );
      pathLowerMeta = pathNode.posix.resolve(
        this.lower.dir,
        pathLower,
        partsLowerLastMeta,
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
      cipherText = await this.workerManager.call(async (w) => {
        const [cipherBuf, cipherOffset, cipherLength] = await w.encryptWithKey(
          Transfer(this.key.buffer),
          this.key.byteOffset,
          this.key.byteLength,
          // @ts-ignore
          Transfer(plainText.buffer),
          plainText.byteOffset,
          plainText.byteLength,
        );
        return Buffer.from(cipherBuf, cipherOffset, cipherLength);
      });
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
  protected async decrypt(cipherText: Buffer): Promise<Buffer | undefined> {
    let plainText: Buffer | undefined;
    if (this.workerManager) {
      plainText = await this.workerManager.call(async (w) => {
        const decrypted = await w.decryptWithKey(
          Transfer(this.key.buffer),
          this.key.byteOffset,
          this.key.byteLength,
          // @ts-ignore
          Transfer(cipherText.buffer),
          cipherText.byteOffset,
          cipherText.byteLength,
        );
        if (decrypted != null) {
          return Buffer.from(decrypted[0], decrypted[1], decrypted[2]);
        } else {
          return;
        }
      });
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
