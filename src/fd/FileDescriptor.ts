import type { INodeType, INodeIndex } from '../inodes/types';
import type { DBTransaction } from '@matrixai/db';

import type { INodeManager } from '../inodes';
import * as errorsFd from './errors';
import * as constants from '../constants';
import * as utils from '../utils';
import * as inodesUtils from '../inodes/utils';

class FileDescriptor {
  protected _iNodeMgr: INodeManager;
  protected _ino: INodeIndex;
  protected _flags: number;
  protected _pos: number;

  constructor(iNodeMgr: INodeManager, ino: INodeIndex, flags: number) {
    this._iNodeMgr = iNodeMgr;
    this._ino = ino;
    this._flags = flags;
    this._pos = 0;
  }

  /**
   * Gets the INode index
   */
  get ino() {
    return this._ino;
  }

  /**
   * Gets the file descriptor flags
   * Unlike Linux filesystems, this retains creation and status flags
   */
  get flags(): number {
    return this._flags;
  }

  /**
   * Sets the file descriptor flags.
   */
  set flags(flags: number) {
    this._flags = flags;
    return;
  }

  /**
   * Gets the file descriptor position.
   */
  get pos(): number {
    return this._pos;
  }

  /**
   * Sets the file descriptor position.
   */
  public async setPos(
    pos: number,
    flags: number = constants.SEEK_SET,
    tran?: DBTransaction,
  ): Promise<void> {
    if (tran == null) {
      return await this._iNodeMgr.withTransactionF(this._ino, async (tran) =>
        this.setPos(pos, flags, tran),
      );
    }
    let newPos;
    const type = await tran.get<INodeType>([
      ...this._iNodeMgr.iNodesDbPath,
      inodesUtils.iNodeId(this._ino),
    ]);
    const size = await this._iNodeMgr.statGetProp(this._ino, 'size', tran);
    switch (type) {
      case 'File':
      case 'Directory':
        {
          switch (flags) {
            case constants.SEEK_SET:
              newPos = pos;
              break;
            case constants.SEEK_CUR:
              newPos = this._pos + pos;
              break;
            case constants.SEEK_END:
              newPos = size + pos;
              break;
            default:
              newPos = this._pos;
          }
          if (newPos < 0) {
            throw new errorsFd.ErrorFileDescriptorInvalidPosition(
              `Position ${newPos} is not reachable`,
            );
          }
          this._pos = newPos;
        }
        break;
      default:
        throw new errorsFd.ErrorFileDescriptorInvalidINode(
          `Invalid INode Type ${type}`,
        );
    }
  }

  /*
   * The read function will take in the Buffer that the plaintext
   * will be returned into, and optionally the position to start
   * reading from in the data. If not, reading starts from the
   * current position. The function will read up to the length of
   * the provided buffer.
   */
  public async read(buffer: Buffer, position?: number): Promise<number> {
    // Check that the iNode is a valid type (for now, only File iNodes)
    let type, blkSize;
    await this._iNodeMgr.withTransactionF(this._ino, async (tran) => {
      type = await tran.get<INodeType>([
        ...this._iNodeMgr.iNodesDbPath,
        inodesUtils.iNodeId(this._ino),
      ]);
      blkSize = await this._iNodeMgr.statGetProp(this._ino, 'blksize', tran);
    });
    // Determine the starting position within the data
    let currentPos = this._pos;
    if (position != null) {
      currentPos = position;
    }
    let bytesRead = buffer.byteLength;
    switch (type) {
      case 'File':
        {
          // Get the starting block index
          const blockStartIdx = utils.blockIndexStart(blkSize, currentPos);
          // Determines the offset of blocks
          const blockOffset = utils.blockOffset(blkSize, currentPos);
          // Determines the number of blocks
          const blockLength = utils.blockLength(
            blkSize,
            blockOffset,
            bytesRead,
          );
          // Get the ending block index
          const blockEndIdx = utils.blockIndexEnd(blockStartIdx, blockLength);
          // Get the cursor offset for the start and end blocks
          const blockCursorStart = utils.blockOffset(blkSize, currentPos);
          const blockCursorEnd = utils.blockOffset(
            blkSize,
            currentPos + bytesRead - 1,
          );
          // Initialise counters for the read buffer and block position
          let retBufferPos = 0;
          let blockCounter = blockStartIdx;
          await this._iNodeMgr.withTransactionF(this._ino, async (tran) => {
            // Iterate over the blocks in the database
            for await (const block of this._iNodeMgr.fileGetBlocks(
              this._ino,
              blkSize,
              blockStartIdx,
              blockEndIdx + 1,
              tran,
            )) {
              // Add the block to the return buffer (handle the start and end blocks)
              if (
                blockCounter === blockStartIdx &&
                blockCounter === blockEndIdx
              ) {
                retBufferPos += block.copy(
                  buffer,
                  retBufferPos,
                  blockCursorStart,
                  blockCursorEnd + 1,
                );
              } else if (blockCounter === blockStartIdx) {
                retBufferPos += block.copy(
                  buffer,
                  retBufferPos,
                  blockCursorStart,
                );
              } else if (blockCounter === blockEndIdx) {
                retBufferPos += block.copy(
                  buffer,
                  retBufferPos,
                  0,
                  blockCursorEnd + 1,
                );
              } else {
                retBufferPos += block.copy(buffer, retBufferPos);
              }

              // Increment the block counter
              blockCounter++;
            }
          });

          // Set the access time in the metadata
          await this._iNodeMgr.withTransactionF(this._ino, async (tran) => {
            const now = new Date();
            await this._iNodeMgr.statSetProp(this._ino, 'atime', now, tran);
          });

          bytesRead = retBufferPos;
        }
        break;
      default:
        throw new errorsFd.ErrorFileDescriptorInvalidINode(
          `Invalid INode Type ${type}`,
        );
    }

    // If the default position used, increment by the bytes read in
    if (position == null) {
      this._pos = currentPos + bytesRead;
    }

    // Return the number of bytes read in
    return bytesRead;
  }

  /**
   * Writes to this file descriptor.
   * If position is specified, the position change does not persist.
   */
  public async write(
    buffer: Buffer,
    position?: number,
    extraFlags: number = 0,
  ): Promise<number> {
    // Check that the iNode is a valid type
    let type, blkSize;
    await this._iNodeMgr.withTransactionF(this._ino, async (tran) => {
      type = await tran.get<INodeType>([
        ...this._iNodeMgr.iNodesDbPath,
        inodesUtils.iNodeId(this._ino),
      ]);
      blkSize = await this._iNodeMgr.statGetProp(this._ino, 'blksize', tran);
    });
    // Determine the starting position within the data
    let currentPos = this._pos;
    if (position != null) {
      currentPos = position;
    }
    let bytesWritten = 0;
    switch (type) {
      case 'File':
        {
          if ((this._flags | extraFlags) & constants.O_APPEND) {
            let idx, value;
            // To append we check the idx and length of the last block
            await this._iNodeMgr.withTransactionF(this._ino, async (tran) => {
              [idx, value] = await this._iNodeMgr.fileGetLastBlock(
                this._ino,
                tran,
              );
              if (value.byteLength === blkSize) {
                // If the last block is full, begin writing from the next block index
                await this._iNodeMgr.fileSetBlocks(
                  this._ino,
                  buffer,
                  blkSize,
                  idx + 1,
                  tran,
                );
              } else if (value.byteLength + buffer.byteLength > blkSize) {
                // If the last block is not full and additional data will exceed block size
                // Copy the bytes until block size is reached and write into the last block at offset
                const startBuffer = Buffer.alloc(blkSize - value.byteLength);
                buffer.copy(startBuffer);
                const writeBytes = await this._iNodeMgr.fileWriteBlock(
                  this._ino,
                  startBuffer,
                  idx,
                  value.byteLength,
                  tran,
                );
                // Copy the remaining bytes and write this into the next block(s)
                const endBuffer = Buffer.alloc(buffer.byteLength - writeBytes);
                buffer.copy(endBuffer, 0, writeBytes);
                await this._iNodeMgr.fileSetBlocks(
                  this._ino,
                  endBuffer,
                  blkSize,
                  idx + 1,
                  tran,
                );
              } else {
                // If the last block is not full and additional data will not exceed block size
                // Write the data into this block at the offset
                await this._iNodeMgr.fileWriteBlock(
                  this._ino,
                  buffer,
                  idx,
                  value.byteLength,
                  tran,
                );
              }
              bytesWritten = buffer.byteLength;
            });
            // Move the cursor to the end of the existing data
            currentPos = idx * blkSize + value.byteLength;
          } else {
            // Get the starting block index
            const blockStartIdx = utils.blockIndexStart(blkSize, currentPos);
            // Determines the offset of blocks
            const blockOffset = utils.blockOffset(blkSize, currentPos);
            // Determines the number of blocks
            const blockLength = utils.blockLength(
              blkSize,
              blockOffset,
              buffer.byteLength,
            );
            // Get the ending block index
            const blockEndIdx = utils.blockIndexEnd(blockStartIdx, blockLength);

            // Get the cursors for the start and end blocks
            const blockCursorStart = utils.blockOffset(blkSize, currentPos);
            const blockCursorEnd = utils.blockOffset(
              blkSize,
              currentPos + buffer.byteLength - 1,
            );

            // Initialise write buffer and block position counters
            let writeBufferPos = 0;
            let blockCounter = blockStartIdx;

            await this._iNodeMgr.withTransactionF(this._ino, async (tran) => {
              for (const idx of utils.range(blockStartIdx, blockEndIdx + 1)) {
                // For each data segment write the data to the index in the database
                if (
                  blockCounter === blockStartIdx &&
                  blockCounter === blockEndIdx
                ) {
                  // If this block is both the start and end block, write the data in at the offset
                  writeBufferPos += await this._iNodeMgr.fileWriteBlock(
                    this._ino,
                    buffer,
                    idx,
                    blockCursorStart,
                    tran,
                  );
                } else if (blockCounter === blockStartIdx) {
                  // If this block is only the start block, copy the relevant bytes from the data to
                  // satisfy the offset and write these to the block at the offset
                  const copyBuffer = Buffer.alloc(blkSize - blockCursorStart);
                  buffer.copy(copyBuffer);
                  writeBufferPos += await this._iNodeMgr.fileWriteBlock(
                    this._ino,
                    copyBuffer,
                    idx,
                    blockCursorStart,
                    tran,
                  );
                } else if (blockCounter === blockEndIdx) {
                  // If this block is only the end block, copy the relevant bytes from the data to
                  // satisfy the offset and write these to the block
                  const copyBuffer = Buffer.alloc(blockCursorEnd + 1);
                  buffer.copy(copyBuffer, 0, writeBufferPos);
                  writeBufferPos += await this._iNodeMgr.fileWriteBlock(
                    this._ino,
                    copyBuffer,
                    idx,
                    undefined,
                    tran,
                  );
                } else {
                  // If the block is a middle block, overwrite the whole block with the relevant bytes
                  const copyBuffer = Buffer.alloc(blkSize);
                  buffer.copy(copyBuffer, 0, writeBufferPos);
                  writeBufferPos += await this._iNodeMgr.fileWriteBlock(
                    this._ino,
                    copyBuffer,
                    idx,
                    undefined,
                    tran,
                  );
                }

                // Increment the block counter
                blockCounter++;
              }
            });
            // Set the amount of bytes written
            bytesWritten = writeBufferPos;
          }

          // Set the modified time, changed time, size and blocks of the file iNode
          await this._iNodeMgr.withTransactionF(this._ino, async (tran) => {
            const now = new Date();
            await this._iNodeMgr.statSetProp(this._ino, 'mtime', now, tran);
            await this._iNodeMgr.statSetProp(this._ino, 'ctime', now, tran);
            // Calculate the size of the new data
            let size = await this._iNodeMgr.statGetProp(
              this._ino,
              'size',
              tran,
            );
            size =
              currentPos + buffer.byteLength > size
                ? currentPos + buffer.byteLength
                : size;
            await this._iNodeMgr.statSetProp(this._ino, 'size', size, tran);
            await this._iNodeMgr.statSetProp(
              this._ino,
              'blocks',
              Math.ceil(size / blkSize),
              tran,
            );
          });
        }
        break;
      default:
        throw new errorsFd.ErrorFileDescriptorInvalidINode(
          `Invalid INode Type ${type}`,
        );
    }

    // If the default position used, increment by the bytes read in
    if (position == null) {
      this._pos = currentPos + bytesWritten;
    }
    // Return the number of bytes written
    return bytesWritten;
  }
}

export default FileDescriptor;
