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
      console.log(type);
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
    if (position === null) {
      this._pos = currentPos + bytesRead;
    }
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
    if (position) {
      currentPos = position;
    }

    let bytesWritten = 0;

    // Define the block size as constant (for now)
    const blockSize = 5;

    if ((this._flags | extraFlags) & vfs.constants.O_APPEND) {
      let idx, value;
      // To append we check the idx of the last block and write to this block
      await this._iNodeMgr.transact(async (tran) => {
        [idx, value] = await this._iNodeMgr.fileGetLastBlock(tran, this._ino);
        if (value.length == blockSize) {
          await this._iNodeMgr.fileSetBlocks(tran, this._ino, buffer, blockSize, idx + 1);
        } else if (value.length + buffer.length > blockSize) {
          const startBuffer = Buffer.alloc(blockSize - value.length);
          buffer.copy(startBuffer);
          const writeBytes = await this._iNodeMgr.fileWriteBlock(tran, this._ino, startBuffer, idx, value.length);
          const endBuffer = Buffer.alloc(buffer.length - writeBytes);
          buffer.copy(endBuffer, 0, writeBytes);
          await this._iNodeMgr.fileSetBlocks(tran, this._ino, endBuffer, blockSize, idx + 1);
        } else {
          await this._iNodeMgr.fileWriteBlock(tran, this._ino, buffer, idx, value.length);
        }
        bytesWritten = buffer.length;
      }, [this._ino]);
      // Move the cursor to the end of the existing data
      // TODO: Check this? should this really happen?
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
            writeBufferPos += await this._iNodeMgr.fileWriteBlock(tran, this._ino, buffer, idx, blockCursorStart);
          } else if (blockCounter === blockStartIdx) {
            const copyBuffer = Buffer.alloc(blockSize - blockCursorStart);
            buffer.copy(copyBuffer);
            writeBufferPos += await this._iNodeMgr.fileWriteBlock(tran, this._ino, copyBuffer, idx, blockCursorStart);
          } else if (blockCounter === blockEndIdx) {
            const copyBuffer = Buffer.alloc(blockCursorEnd + 1);
            buffer.copy(copyBuffer, 0, writeBufferPos);
            writeBufferPos += await this._iNodeMgr.fileWriteBlock(tran, this._ino, copyBuffer, idx);
          } else {
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

    // TODO: Set Metadata

    // If the default position used, increment by the bytes read in
    if (position === null) {
      this._pos = currentPos + bytesWritten;
    }
    // Return the number of bytes written
    return bytesWritten;
  }
}

export default FileDescriptor;
