import { File } from '../inodes';

import * as utils from '../utils';
/*
 * File descriptor class which uses the INode type as a template
 * For now, this will just focus on the File INode, specifically the
 * read function
 * I have filled out the basic fd structure from js-virtualfs
 */
class FileDescriptor<T> {
  protected iNode: T;
  protected flags: number;
  protected pos: number;

  constructor (iNode: T, flags: number) {
    this.iNode = iNode;
    this.flags = flags;
    this.pos = 0;
  }

  /*
   * The read function will take in the Buffer that the plaintext
   * will be returned into, and optionally the position to start
   * reading from in the data. If not, reading starts from the
   * current position. The function will read up to the length of
   * the provided buffer.
   */
  public static read(buffer: Buffer, position?: number): number {
    // Check that the iNode is a valid type (for now, only File iNodes)
    // if (this.iNode !instanceof File) {
    //   throw Error();
    // }

    // Determine the starting position within the data
    // let currentPos = this.pos;
    let currentPos = 2;
    if (position) {
      currentPos = position;
    }

    // Obtain the block size used by the iNode and the number
    // of bytes to read
    const blockSize = 2;
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

    // Iterate over the blocks ranges
    for (const idx of utils.range(blockStartIdx, blockEndIdx + 1)) {
      // Load the block from the database
      // for await (const block of this.iNode.getBlock()) {
          const buf = Buffer.from('Hello world, I am Computron - The Office 2016');
      // }

      // Add the block to the return buffer (handle the start and end blocks)
      if(idx === blockStartIdx && idx === blockEndIdx) {
        retBufferPos += buf.copy(buffer, retBufferPos, blockCursorStart, blockCursorEnd + 1);
      } else if (idx === blockStartIdx) {
        retBufferPos += buf.copy(buffer, retBufferPos, blockCursorStart);
      } else if (idx === blockEndIdx) {
        retBufferPos += buf.copy(buffer, retBufferPos, 0, blockCursorEnd + 1);
      } else {
        retBufferPos += buf.copy(buffer, retBufferPos);
      }
    }

    // Return the number of bytes read in
    return retBufferPos;
  }
}

export default FileDescriptor;
