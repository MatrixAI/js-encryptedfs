import type { POJO } from './types';
import { AbstractError } from '@matrixai/errors';

class ErrorEncryptedFS<T> extends AbstractError<T> {
  static description = 'EncryptedFS error';
}

class ErrorEncryptedFSRunning<T> extends ErrorEncryptedFS<T> {
  static description = 'EncryptedFS is running';
}

class ErrorEncryptedFSNotRunning<T> extends ErrorEncryptedFS<T> {
  static description = 'EncryptedFS is not running';
}

class ErrorEncryptedFSDestroyed<T> extends ErrorEncryptedFS<T> {
  static description = 'EncryptedFS is destroyed';
}

class ErrorEncryptedFSKey<T> extends ErrorEncryptedFS<T> {
  static description = 'EncryptedFS failed canary check';
}

class ErrorEncryptedFSError<T> extends ErrorEncryptedFS<T> {
  static description = 'EncryptedFS filesystem error';

  protected _errno: number;
  protected _code: string;
  protected _description: string;
  protected _syscall?: string;

  constructor(
    {
      errno,
      path,
      dest,
      syscall,
    }: {
      errno: {
        errno: number;
        code: string;
        description: string;
      };
      path?: string;
      dest?: string;
      syscall?: string;
    },
    options: {
      timestamp?: Date;
      data?: POJO;
      cause?: T;
    } = {},
  ) {
    let message = errno.code + ': ' + errno.description;
    if (path != null) {
      message += ', ' + path;
      if (dest != null) message += ' -> ' + dest;
    }
    super(message, options);
    this._errno = errno.errno;
    this._code = errno.code;
    this._description = errno.description;
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
  ErrorEncryptedFSKey,
  ErrorEncryptedFSError,
};
