import type { EncryptedFSLayers } from './types';
import fs from 'fs';

/**
 * Class representing an encrypted file system error.
 * @extends Error
 */
class EncryptedFSError extends Error {
  errno: number;
  code: string;
  errnoDescription: string;
  syscall?: string;
  layer: EncryptedFSLayers;

  /**
   * Creates EncryptedFSError.
   */
  constructor(
    errnoObj: { errno: number; code: string; description: string },
    path?: fs.PathLike | number | null,
    dest?: fs.PathLike | number | null,
    syscall?: string | null,
    layer?: EncryptedFSLayers | null,
  ) {
    let message = errnoObj.code + ': ' + errnoObj.description;
    if (layer != null) {
      message += ', ' + layer;
    }
    if (path != null) {
      message += ', ' + path;
      if (dest != null) message += ' -> ' + dest;
    }
    super(message);
    this.errno = errnoObj.errno;
    this.code = errnoObj.code;
    this.errnoDescription = errnoObj.description;
    if (syscall != null) {
      this.syscall = syscall;
    }
  }

  setPaths(src: string, dst?: string) {
    let message = this.code + ': ' + this.errnoDescription + ', ' + src;
    if (dst != null) message += ' -> ' + dst;
    this.message = message;
    return;
  }

  setSyscall(syscall: string) {
    this.syscall = syscall;
  }
}

export { EncryptedFSError };
export { code as errno } from 'errno';
