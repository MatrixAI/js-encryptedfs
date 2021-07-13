import { VirtualFSError } from 'virtualfs';
import { EncryptedFSLayer } from './util';

class EncryptedFSError extends VirtualFSError {
  public readonly layer: EncryptedFSLayer;
  constructor (
    layer: EncryptedFSLayer,
    ...args: ConstructorParameters<VirtualFSError>
  ) {
    super(...args);
    this.layer = layer;
  }
}

export { EncryptedFSError };
export { code as errno } from 'errno';
