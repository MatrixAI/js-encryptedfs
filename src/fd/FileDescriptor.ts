import type { INodeType } from '../inodes/types';
import type { DBTransaction } from '../db/types';

import { INodeIndex } from '@/inodes/types';
import { INodeManager } from '../inodes';

import * as utils from '../utils';
import * as inodesUtils from '../inodes/utils';

/*
 * File descriptor class which uses the INode type as a template
 * For now, this will just focus on the File INode, specifically the
 * read function
 * I have filled out the basic fd structure from js-virtualfs
 */
class FileDescriptor {
  protected _iNodeMgr: INodeManager;
  protected _ino: INodeIndex;
  protected _flags: number;
  protected _pos: number;

  constructor (iNodeMgr: INodeManager, ino: INodeIndex, flags: number) {
    this._iNodeMgr = iNodeMgr;
    this._ino = ino;
    this._flags = flags;
    this._pos = 0;
  }

  /*
   * The read function will take in the Buffer that the plaintext
   * will be returned into, and optionally the position to start
   * reading from in the data. If not, reading starts from the
   * current position. The function will read up to the length of
   * the provided buffer.
   */
  public async read(
    tran: DBTransaction,
    buffer: Buffer,
    position?: number
  ): Promise<number> {
    // Check that the iNode is a valid type (for now, only File iNodes)
    const type = await tran.get<INodeType>(
      this._iNodeMgr.iNodesDomain,
      inodesUtils.iNodeId(this._ino),
    );
    if (type != 'File') {
      throw Error();
    }

    // Determine the starting position within the data
    let currentPos = this._pos;
    if (position) {
      currentPos = position;
    }

    // Obtain the block size used by the iNode and the number
    // of bytes to read
    const blockSize = 5;
    let bytesRead = buffer.length;

    // Get the starting block index
    const blockStartIdx = utils.blockIndexStart(
      blockSize,
      currentPos,
    );
    // Determines the offset of blocks
    const blockOffset = utils.blockOffset(
      blockSize,
      currentPos,
    );
    // Determines the number of blocks
    const blockLength = utils.blockLength(
      blockSize,
      blockOffset,
      bytesRead,
    );
    // Get the ending block index
    const blockEndIdx = utils.blockIndexEnd(
      blockStartIdx,
      blockLength,
    );
    const blockCursorStart = utils.blockOffset(blockSize, currentPos);
    const blockCursorEnd = utils.blockOffset(blockSize, currentPos + bytesRead - 1);
    let retBufferPos = 0;
    let blockCounter = blockStartIdx;

    // Iterate over the blocks ranges
    for await (const block of this._iNodeMgr.fileGetBlocks(tran, this._ino, blockStartIdx, blockEndIdx)) {

      // Add the block to the return buffer (handle the start and end blocks)
      if(blockCounter === blockStartIdx && blockCounter === blockEndIdx) {
        retBufferPos += block.copy(buffer, retBufferPos, blockCursorStart, blockCursorEnd + 1);
      } else if (blockCounter === blockStartIdx) {
        retBufferPos += block.copy(buffer, retBufferPos, blockCursorStart);
      } else if (blockCounter === blockEndIdx) {
        retBufferPos += block.copy(buffer, retBufferPos, 0, blockCursorEnd + 1);
      } else {
        retBufferPos += block.copy(buffer, retBufferPos);
      }

      // Increment the block counter
      blockCounter++;
    }

    // Return the number of bytes read in
    return retBufferPos;
  }

  /**
   * Writes to this file descriptor.
   * If position is specified, the position change does not persist.
   */
  write(buffer: Buffer, position?: number): number {
    // Determine the starting position within the data
    // let currentPos = this.pos;
    let currentPos = 2;
    if (position) {
      currentPos = position;
    }

    // const iNode = this._iNode;
    // let bytesWritten;
    // switch (true) {
    // case iNode instanceof File:
    //   let data = iNode.getData();
    //   const metadata = iNode.getMetadata();
    //   if ((this.getFlags() | extraFlags) & constants.O_APPEND) {
    //     currentPosition = data.length;
    //     data = Buffer.concat([data, buffer]);
    //     bytesWritten = buffer.length;
    //   } else {
    //     if (currentPosition > data.length) {
    //       data = Buffer.concat([
    //         data,
    //         Buffer.alloc(currentPosition - data.length),
    //         Buffer.allocUnsafe(buffer.length)
    //       ]);
    //     } else if (currentPosition <= data.length) {
    //       const overwrittenLength = data.length - currentPosition;
    //       const extendedLength = buffer.length - overwrittenLength;
    //       if (extendedLength > 0) {
    //         data = Buffer.concat([data, Buffer.allocUnsafe(extendedLength)]);
    //       }
    //     }
    //     bytesWritten = buffer.copy(data, currentPosition);
    //   }
    //   iNode.setData(data);
    //   const now = new Date;
    //   metadata.mtime = now;
    //   metadata.ctime = now;
    //   metadata.size = data.length;
    //   break;
    // case iNode instanceof CharacterDev:
    //   const fops = iNode.getFileDesOps();
    //   if (!fops) {
    //     throw new VirtualFSError(errno.ENXIO);
    //   } else if (!fops.write) {
    //     throw new VirtualFSError(errno.EINVAL);
    //   } else {
    //     bytesWritten = fops.write(
    //       this,
    //       buffer,
    //       currentPosition,
    //       extraFlags
    //     );
    //   }
    //   break;
    // default:
    //   throw new VirtualFSError(errno.EINVAL);
    // }
    // if (position === null) {
    //   this._pos = currentPosition + bytesWritten;
    // }
    return 1;
  }
}

export default FileDescriptor;
