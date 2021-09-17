import { CustomError } from 'ts-custom-error';

class ErrorEncryptedFS extends CustomError {}

class ErrorEncryptedFSRunning extends ErrorEncryptedFS {}

class ErrorEncryptedFSNotRunning extends ErrorEncryptedFS {}

class ErrorEncryptedFSDestroyed extends ErrorEncryptedFS {}

class ErrorEncryptedFSError extends ErrorEncryptedFS {
  protected _errno: number;
  protected _code: string;
  protected _description: string;
  protected _syscall?: string;

  constructor(
    errnoObj: {
      errno: number, code: string, description: string
    },
    path?: string,
    dest?: string,
    syscall?: string
  ) {
    let message = errnoObj.code + ': ' + errnoObj.description;
    if (path != null) {
      message += ', ' + path;
      if (dest != null) message += ' -> ' + dest;
    }
    super(message);
    this._errno = errnoObj.errno;
    this._code = errnoObj.code;
    this._description = errnoObj.description;
    this._syscall = syscall;
  }

  setPaths(src: string, dst?: string) {
    let message = this.code + ': ' + this.description + ', ' + src;
    if (dst != null) message += ' -> ' + dst;
    this.message = message;
  }

  setSyscall(syscall: string) {
    this._syscall = syscall;
  }

  get errno(): number {
    return this._errno;
  }

  get code(): string {
    return this._code;
  }

  get description(): string {
    return this._description;
  }

  get syscall(): string | undefined {
    return this._syscall;
  }
}

export {
  ErrorEncryptedFS,
  ErrorEncryptedFSRunning,
  ErrorEncryptedFSNotRunning,
  ErrorEncryptedFSDestroyed,
  ErrorEncryptedFSError,
};
