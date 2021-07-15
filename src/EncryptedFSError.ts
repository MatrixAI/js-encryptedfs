import { VirtualFSError } from 'virtualfs';

class EncryptedFSError extends VirtualFSError {
  constructor (
    ...args: ConstructorParameters<typeof VirtualFSError>
  ) {
    super(...args);
  }
}

export { EncryptedFSError };
export { code as errno } from 'errno';
