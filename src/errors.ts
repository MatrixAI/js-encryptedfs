import type { POJO } from './types';
import type { Class } from '@matrixai/errors';
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

  public static fromJSON<T extends Class<any>>(
    this: T,
    json: any,
  ): InstanceType<T> {
    if (
      typeof json !== 'object' ||
      json.type !== this.name ||
      typeof json.data !== 'object' ||
      typeof json.data.message !== 'string' ||
      isNaN(Date.parse(json.data.timestamp)) ||
      typeof json.data.data !== 'object' ||
      typeof json.data._errno != 'number' ||
      typeof json.data._code != 'string' ||
      typeof json.data._description != 'string' ||
      !('cause' in json.data) ||
      ('stack' in json.data && typeof json.data.stack !== 'string') ||
      ('_syscall' in json.data && typeof json.data._syscall !== 'string')
    ) {
      throw new TypeError(`Cannot decode JSON to ${this.name}`);
    }
    const e = new this(
      {
        errno: {
          errno: json.data._errno,
          code: json.data._code,
          description: json.data._description,
        },
        message: json.data.message,
        syscall: json.data._syscall,
      },
      {
        timestamp: new Date(json.data.timestamp),
        data: json.data.data,
        cause: json.data.cause,
      },
    );
    e.stack = json.data.stack;
    return e;
  }

  protected _errno: number;
  protected _code: string;
  protected _description: string;
  protected _syscall?: string;

  constructor(
    {
      errno,
      message,
      path,
      dest,
      syscall,
    }: {
      errno: {
        errno: number;
        code: string;
        description: string;
      };
      message?: string;
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
    if (message == null) {
      message = errno.code + ': ' + errno.description;
      if (path != null) {
        message += ', ' + path;
        if (dest != null) message += ' -> ' + dest;
      }
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

  public toJSON(): any {
    const json = super.toJSON();
    json.data._errno = this._errno;
    json.data._code = this._code;
    json.data._description = this._description;
    json.data._syscall = this._syscall;
    return json;
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
