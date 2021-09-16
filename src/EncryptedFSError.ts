import { CustomError } from 'ts-custom-error';

class EncryptedFSError extends CustomError {
  public readonly error?: NodeJS.ErrnoException;

  constructor(error?: NodeJS.ErrnoException, message: string = '') {
    if (error != null) {
      super(error.message);
    } else {
      super(message);
    }
    this.error = error;
  }

  get errno(): number | undefined {
    return this.error?.errno;
  }

  get code(): string | undefined {
    return this.error?.code;
  }

  get syscall(): string | undefined {
    return this.error?.syscall;
  }
}

export { EncryptedFSError };
export { code as errno } from 'errno';
