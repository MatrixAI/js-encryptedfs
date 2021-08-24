import type { INodeType } from '../inodes/types';
import type { DBTransaction } from '../db/types';

import { INodeIndex } from '@/inodes/types';
import { INodeManager } from '../inodes';

import * as vfs from 'virtualfs';

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
    this._iNodeMgr.ref(this._ino);
  }

  /**
   * Gets the file descriptor position.
   */
  get pos (): number {
    return this._pos;
  }

  /**
   * Deletes a file descriptor.
   * This effectively closes the file descriptor.
   * This will decrement the reference to the iNode allowing garbage collection by the INodeManager.
   */
  public async destroy(): Promise<void> {
    await this._iNodeMgr.transact(async (tran) => {
      await this._iNodeMgr.unref(tran, this._ino);
    });
  }

  /*
   * The read function will take in the Buffer that the plaintext
   * will be returned into, and optionally the position to start
   * reading from in the data. If not, reading starts from the
   * current position. The function will read up to the length of
   * the provided buffer.
   */
  public async read(
    buffer: Buffer,
    position?: number
  ): Promise<number> {
    // Check that the iNode is a valid type (for now, only File iNodes)
    let type;
    await this._iNodeMgr.transact(async (tran) => {
      type = await tran.get<INodeType>(
        this._iNodeMgr.iNodesDomain,
        inodesUtils.iNodeId(this._ino),
      );
    }, [this._ino]);
    if (type != 'File') {
      throw Error();
    }

    // Determine the starting position within the data
    let currentPos = this._pos;
    if (position != undefined) {
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

    // Get the cursor offset for the start and end blocks
    const blockCursorStart = utils.blockOffset(blockSize, currentPos);
    const blockCursorEnd = utils.blockOffset(blockSize, currentPos + bytesRead - 1);

    // Initialise counters for the read buffer and block position
    let retBufferPos = 0;
    let blockCounter = blockStartIdx;

    await this._iNodeMgr.transact(async (tran) => {
    // Iterate over the blocks in the database
      for await (const block of this._iNodeMgr.fileGetBlocks(tran, this._ino, blockSize, blockStartIdx, blockEndIdx + 1)) {
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
    }, [this._ino]);

    // If the default position used, increment by the bytes read in
    if (position == undefined) {
      this._pos = currentPos + bytesRead;
    }

    // Set the access time in the metadata
    await this._iNodeMgr.transact(async (tran) => {
      const now = new Date;
      await this._iNodeMgr.statSetProp(tran, this._ino, 'atime', now);
    }, [this._ino]);

    // Return the number of bytes read in
    return retBufferPos;
  }

  /**
   * Writes to this file descriptor.
   * If position is specified, the position change does not persist.
   */
  public async write(buffer: Buffer, position?: number, extraFlags: number = 0): Promise<number> {
    // Check that the iNode is a valid type (for now, only File iNodes)
    let type;
    await this._iNodeMgr.transact(async (tran) => {
      type = await tran.get<INodeType>(
        this._iNodeMgr.iNodesDomain,
        inodesUtils.iNodeId(this._ino),
      );
    }, [this._ino]);
    if (type != 'File') {
      console.log(type);
      throw Error();
    }

    // Determine the starting position within the data
    let currentPos = this._pos;
    if (position != undefined) {
      currentPos = position;
    }

    // Define the block size as constant (for now)
    const blockSize = 5;
    let bytesWritten = 0;

    if ((this._flags | extraFlags) & vfs.constants.O_APPEND) {
      let idx, value;
      // To append we check the idx and length of the last block
      await this._iNodeMgr.transact(async (tran) => {
        [idx, value] = await this._iNodeMgr.fileGetLastBlock(tran, this._ino);
        if (value.length == blockSize) {
          // If the last block is full, begin writing from the next block index
          await this._iNodeMgr.fileSetBlocks(tran, this._ino, buffer, blockSize, idx + 1);
        } else if (value.length + buffer.length > blockSize) {
          // If the last block is not full and additional data will exceed block size
          // Copy the bytes until block size is reached and write into the last block at offset
          const startBuffer = Buffer.alloc(blockSize - value.length);
          buffer.copy(startBuffer);
          const writeBytes = await this._iNodeMgr.fileWriteBlock(tran, this._ino, startBuffer, idx, value.length);
          // Copy the remaining bytes and write this into the next block(s)
          const endBuffer = Buffer.alloc(buffer.length - writeBytes);
          buffer.copy(endBuffer, 0, writeBytes);
          await this._iNodeMgr.fileSetBlocks(tran, this._ino, endBuffer, blockSize, idx + 1);
        } else {
          // If the last block is not full and additional data will not exceed block size
          // Write the data into this block at the offset
          await this._iNodeMgr.fileWriteBlock(tran, this._ino, buffer, idx, value.length);
        }
        bytesWritten = buffer.length;
      }, [this._ino]);
      // Move the cursor to the end of the existing data
      currentPos = idx * blockSize + value.length;
    } else {
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
        buffer.length,
      );
      // Get the ending block index
      const blockEndIdx = utils.blockIndexEnd(
        blockStartIdx,
        blockLength,
      );

      // Get the cursors for the start and end blocks
      const blockCursorStart = utils.blockOffset(blockSize, currentPos);
      const blockCursorEnd = utils.blockOffset(blockSize, currentPos + buffer.length - 1);

      // Initialise write buffer and block position counters
      let writeBufferPos = 0;
      let blockCounter = blockStartIdx;

      await this._iNodeMgr.transact(async (tran) => {
        for (const idx of utils.range(blockStartIdx, blockEndIdx + 1)) {
          // For each data segment write the data to the index in the database
          if(blockCounter === blockStartIdx && blockCounter === blockEndIdx) {
            // If this block is both the start and end block, write the data in at the offset
            writeBufferPos += await this._iNodeMgr.fileWriteBlock(tran, this._ino, buffer, idx, blockCursorStart);
          } else if (blockCounter === blockStartIdx) {
            // If this block is only the start block, copy the relevant bytes from the data to
            // satisfy the offset and write these to the block at the offset
            const copyBuffer = Buffer.alloc(blockSize - blockCursorStart);
            buffer.copy(copyBuffer);
            writeBufferPos += await this._iNodeMgr.fileWriteBlock(tran, this._ino, copyBuffer, idx, blockCursorStart);
          } else if (blockCounter === blockEndIdx) {
            // If this block is only the end block, copy the relevant bytes from the data to
            // satisfy the offset and write these to the block
            const copyBuffer = Buffer.alloc(blockCursorEnd + 1);
            buffer.copy(copyBuffer, 0, writeBufferPos);
            writeBufferPos += await this._iNodeMgr.fileWriteBlock(tran, this._ino, copyBuffer, idx);
          } else {
            // If the block is a middle block, overwrite the whole block with the relevant bytes
            const copyBuffer = Buffer.alloc(blockSize);
            buffer.copy(copyBuffer, 0, writeBufferPos);
            writeBufferPos += await this._iNodeMgr.fileWriteBlock(tran, this._ino, copyBuffer, idx);
          }

          // Increment the block counter
          blockCounter++;
        }
      }, [this._ino]);
      // Set the amount of bytes written
      bytesWritten = writeBufferPos;
    }

    // Set the modified time, changed time, size and blocks of the file iNode
    await this._iNodeMgr.transact(async (tran) => {
      const now = new Date;
      await this._iNodeMgr.statSetProp(tran, this._ino, 'mtime', now);
      await this._iNodeMgr.statSetProp(tran, this._ino, 'ctime', now);
      // Calculate the size of the new data
      let size = await this._iNodeMgr.statGetProp(tran, this._ino, 'size');
      size = currentPos + buffer.length > size ? currentPos + buffer.length : size;
      await this._iNodeMgr.statSetProp(tran, this._ino, 'size', size);
      await this._iNodeMgr.statSetProp(tran, this._ino, 'blocks', Math.ceil(size / blockSize));
    }, [this._ino]);

    // If the default position used, increment by the bytes read in
    if (position == undefined) {
      this._pos = currentPos + bytesWritten;
    }
    // Return the number of bytes written
    return bytesWritten;
  }
}

export default FileDescriptor;
