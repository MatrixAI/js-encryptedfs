import type { EncryptedFSLayer } from './types';

import { VirtualFSError } from 'virtualfs';

/**
 * Consider encapsulating the VFS error
 * Not extending it.
 * It makes more sense, and helps with debugging
 */

class EncryptedFSError extends VirtualFSError {
  public readonly layer: EncryptedFSLayer;
  constructor (
    layer: EncryptedFSLayer,
    ...args: ConstructorParameters<typeof VirtualFSError>
  ) {
    super(...args);
    this.layer = layer;
  }
}

export { EncryptedFSError };
export { code as errno } from 'errno';
