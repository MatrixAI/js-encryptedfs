import type { INodeType } from '../inodes/types';

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
    flags: number = vfs.constants.SEEK_SET,
  ): Promise<void> {
    let newPos, type, size;
    await this._iNodeMgr.transact(
      async (tran) => {
        type = await tran.get<INodeType>(
          this._iNodeMgr.iNodesDomain,
          inodesUtils.iNodeId(this._ino),
        );
        size = await this._iNodeMgr.statGetProp(tran, this._ino, 'size');
      },
      [this._ino],
    );
    switch (type) {
      case 'File':
      case 'Directory':
        {
          switch (flags) {
            case vfs.constants.SEEK_SET:
              newPos = pos;
              break;
            case vfs.constants.SEEK_CUR:
              newPos = this._pos + pos;
              break;
            case vfs.constants.SEEK_END:
              newPos = size + pos;
              break;
            default:
              newPos = this._pos;
          }
          if (newPos < 0) {
            throw Error('Invalid Position');
          }
          this._pos = newPos;
        }
        break;
      case 'CharacterDev':
        {
          let fops;
          await this._iNodeMgr.transact(async (tran) => {
            fops = await this._iNodeMgr.charDevGetFileDesOps(tran, this._ino);
          });
          if (!fops) {
            throw Error('INode does not exist');
          } else {
            fops.setPos(this, pos, flags);
          }
        }
        break;
      default:
        throw Error('Invalid INode Type');
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
    await this._iNodeMgr.transact(
      async (tran) => {
        type = await tran.get<INodeType>(
          this._iNodeMgr.iNodesDomain,
          inodesUtils.iNodeId(this._ino),
        );
        blkSize = await this._iNodeMgr.statGetProp(tran, this._ino, 'blksize');
      },
      [this._ino],
    );

    // Determine the starting position within the data
    let currentPos = this._pos;
    if (position != undefined) {
      currentPos = position;
    }
    let bytesRead = buffer.length;

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

          await this._iNodeMgr.transact(
            async (tran) => {
              // Iterate over the blocks in the database
              for await (const block of this._iNodeMgr.fileGetBlocks(
                tran,
                this._ino,
                blkSize,
                blockStartIdx,
                blockEndIdx + 1,
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
            },
            [this._ino],
          );

          // Set the access time in the metadata
          await this._iNodeMgr.transact(
            async (tran) => {
              const now = new Date();
              await this._iNodeMgr.statSetProp(tran, this._ino, 'atime', now);
            },
            [this._ino],
          );

          bytesRead = retBufferPos;
        }
        break;
      case 'CharacterDev':
        {
          let fops;
          await this._iNodeMgr.transact(async (tran) => {
            fops = await this._iNodeMgr.charDevGetFileDesOps(tran, this._ino);
          });
          if (!fops) {
            throw Error('INode does not exist');
          } else {
            // TODO: Check if this is actually ok, this expects a vfs file descriptor
            // but some things have changed
            bytesRead = fops.read(this, buffer, currentPos);
          }
        }
        break;
      default:
        throw Error('Invalid INode Type');
    }

    // If the default position used, increment by the bytes read in
    if (position == undefined) {
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
    await this._iNodeMgr.transact(
      async (tran) => {
        type = await tran.get<INodeType>(
          this._iNodeMgr.iNodesDomain,
          inodesUtils.iNodeId(this._ino),
        );
        blkSize = await this._iNodeMgr.statGetProp(tran, this._ino, 'blksize');
      },
      [this._ino],
    );

    // Determine the starting position within the data
    let currentPos = this._pos;
    if (position != undefined) {
      currentPos = position;
    }

    let bytesWritten = 0;
    switch (type) {
      case 'File':
        {
          if ((this._flags | extraFlags) & vfs.constants.O_APPEND) {
            let idx, value;
            // To append we check the idx and length of the last block
            await this._iNodeMgr.transact(
              async (tran) => {
                [idx, value] = await this._iNodeMgr.fileGetLastBlock(
                  tran,
                  this._ino,
                );
                if (value.length == blkSize) {
                  // If the last block is full, begin writing from the next block index
                  await this._iNodeMgr.fileSetBlocks(
                    tran,
                    this._ino,
                    buffer,
                    blkSize,
                    idx + 1,
                  );
                } else if (value.length + buffer.length > blkSize) {
                  // If the last block is not full and additional data will exceed block size
                  // Copy the bytes until block size is reached and write into the last block at offset
                  const startBuffer = Buffer.alloc(blkSize - value.length);
                  buffer.copy(startBuffer);
                  const writeBytes = await this._iNodeMgr.fileWriteBlock(
                    tran,
                    this._ino,
                    startBuffer,
                    idx,
                    value.length,
                  );
                  // Copy the remaining bytes and write this into the next block(s)
                  const endBuffer = Buffer.alloc(buffer.length - writeBytes);
                  buffer.copy(endBuffer, 0, writeBytes);
                  await this._iNodeMgr.fileSetBlocks(
                    tran,
                    this._ino,
                    endBuffer,
                    blkSize,
                    idx + 1,
                  );
                } else {
                  // If the last block is not full and additional data will not exceed block size
                  // Write the data into this block at the offset
                  await this._iNodeMgr.fileWriteBlock(
                    tran,
                    this._ino,
                    buffer,
                    idx,
                    value.length,
                  );
                }
                bytesWritten = buffer.length;
              },
              [this._ino],
            );
            // Move the cursor to the end of the existing data
            currentPos = idx * blkSize + value.length;
          } else {
            // Get the starting block index
            const blockStartIdx = utils.blockIndexStart(blkSize, currentPos);
            // Determines the offset of blocks
            const blockOffset = utils.blockOffset(blkSize, currentPos);
            // Determines the number of blocks
            const blockLength = utils.blockLength(
              blkSize,
              blockOffset,
              buffer.length,
            );
            // Get the ending block index
            const blockEndIdx = utils.blockIndexEnd(blockStartIdx, blockLength);

            // Get the cursors for the start and end blocks
            const blockCursorStart = utils.blockOffset(blkSize, currentPos);
            const blockCursorEnd = utils.blockOffset(
              blkSize,
              currentPos + buffer.length - 1,
            );

            // Initialise write buffer and block position counters
            let writeBufferPos = 0;
            let blockCounter = blockStartIdx;

            await this._iNodeMgr.transact(
              async (tran) => {
                for (const idx of utils.range(blockStartIdx, blockEndIdx + 1)) {
                  // For each data segment write the data to the index in the database
                  if (
                    blockCounter === blockStartIdx &&
                    blockCounter === blockEndIdx
                  ) {
                    // If this block is both the start and end block, write the data in at the offset
                    writeBufferPos += await this._iNodeMgr.fileWriteBlock(
                      tran,
                      this._ino,
                      buffer,
                      idx,
                      blockCursorStart,
                    );
                  } else if (blockCounter === blockStartIdx) {
                    // If this block is only the start block, copy the relevant bytes from the data to
                    // satisfy the offset and write these to the block at the offset
                    const copyBuffer = Buffer.alloc(blkSize - blockCursorStart);
                    buffer.copy(copyBuffer);
                    writeBufferPos += await this._iNodeMgr.fileWriteBlock(
                      tran,
                      this._ino,
                      copyBuffer,
                      idx,
                      blockCursorStart,
                    );
                  } else if (blockCounter === blockEndIdx) {
                    // If this block is only the end block, copy the relevant bytes from the data to
                    // satisfy the offset and write these to the block
                    const copyBuffer = Buffer.alloc(blockCursorEnd + 1);
                    buffer.copy(copyBuffer, 0, writeBufferPos);
                    writeBufferPos += await this._iNodeMgr.fileWriteBlock(
                      tran,
                      this._ino,
                      copyBuffer,
                      idx,
                    );
                  } else {
                    // If the block is a middle block, overwrite the whole block with the relevant bytes
                    const copyBuffer = Buffer.alloc(blkSize);
                    buffer.copy(copyBuffer, 0, writeBufferPos);
                    writeBufferPos += await this._iNodeMgr.fileWriteBlock(
                      tran,
                      this._ino,
                      copyBuffer,
                      idx,
                    );
                  }

                  // Increment the block counter
                  blockCounter++;
                }
              },
              [this._ino],
            );
            // Set the amount of bytes written
            bytesWritten = writeBufferPos;
          }

          // Set the modified time, changed time, size and blocks of the file iNode
          await this._iNodeMgr.transact(
            async (tran) => {
              const now = new Date();
              await this._iNodeMgr.statSetProp(tran, this._ino, 'mtime', now);
              await this._iNodeMgr.statSetProp(tran, this._ino, 'ctime', now);
              // Calculate the size of the new data
              let size = await this._iNodeMgr.statGetProp(
                tran,
                this._ino,
                'size',
              );
              size =
                currentPos + buffer.length > size
                  ? currentPos + buffer.length
                  : size;
              await this._iNodeMgr.statSetProp(tran, this._ino, 'size', size);
              await this._iNodeMgr.statSetProp(
                tran,
                this._ino,
                'blocks',
                Math.ceil(size / blkSize),
              );
            },
            [this._ino],
          );
        }
        break;
      case 'CharacterDev':
        {
          {
            let fops;
            await this._iNodeMgr.transact(async (tran) => {
              fops = await this._iNodeMgr.charDevGetFileDesOps(tran, this._ino);
            });
            if (!fops) {
              throw Error('INode does not exist');
            } else {
              // TODO: Check if this is actually ok, this expects a vfs file descriptor
              // but some things have changed
              bytesWritten = fops.write(this, buffer, currentPos, extraFlags);
            }
          }
        }
        break;
      default:
        throw Error('Invalid INode Type');
    }

    // If the default position used, increment by the bytes read in
    if (position == undefined) {
      this._pos = currentPos + bytesWritten;
    }
    // Return the number of bytes written
    return bytesWritten;
  }
}

export default FileDescriptor;
