import type { optionsStream } from './types';
import type { FdIndex } from '../fd/types';
import type { EncryptedFS } from '../';

import * as vfs from 'virtualfs';
import { Writable } from 'stream';
import { Callback } from '@/types';

class WriteStream extends Writable {
  protected _bytesWritten: number;
  protected _fs: EncryptedFS;
  protected _path: string;
  protected _fd?: FdIndex;
  protected _flags: string;
  protected _mode: number;
  protected _autoClose: boolean;
  protected _pos?: number;
  protected _closed?: boolean;

  /**
   * Creates WriteStream.
   */
  constructor(path: string, options: optionsStream, fs: EncryptedFS) {
    super({
      highWaterMark: options.highWaterMark,
    });
    this._fs = fs;
    this._bytesWritten = 0;
    this._path = path;
    this._fd = options.fd === undefined ? undefined : options.fd;
    this._flags = options.flags === undefined ? 'w' : options.flags;
    this._mode =
      options.mode === undefined ? vfs.DEFAULT_FILE_PERM : options.mode;
    this._autoClose =
      options.autoClose === undefined ? true : options.autoClose;
    this._pos = options.start; // WriteStream maintains its own position
    if (options.encoding) {
      super.setDefaultEncoding(options.encoding);
    }
    if (typeof this._fd !== 'number') {
      this._open();
    }
    super.on('finish', () => {
      if (this._autoClose) {
        this.destroy();
      }
    });
  }

  /**
   * Open file descriptor if WriteStream was constructed from a file path.
   */
  protected _open(): void {
    this._fs.open(this._path, this._flags, this._mode, (e, fd) => {
      if (e) {
        if (this._autoClose) {
          this.destroy();
        }
        super.emit('error', e);
        return;
      }
      this._fd = fd;
      super.emit('open', fd);
    });
  }

  /**
   * Asynchronous write hook for stream implementation.
   */
  public _write(
    data: Buffer | string,
    encoding: string | undefined,
    callback: Callback<[WriteStream]>,
  ): WriteStream | void {
    if (typeof this._fd !== 'number') {
      return super.once('open', () => {
        this._write(data, encoding, callback);
      });
    }
    if (this._pos) {
      this._fs.write(
        this._fd,
        data,
        0,
        data.length,
        this._pos,
        (e, bytesWritten) => {
          if (e) {
            if (this._autoClose) {
              this.destroy();
            }
            callback(e);
            return;
          }
          this._bytesWritten += bytesWritten;
          callback(e);
        },
      );
    } else {
      this._fs.write(this._fd, data, 0, data.length, (e, bytesWritten) => {
        if (e) {
          if (this._autoClose) {
            this.destroy();
          }
          callback(e);
          return;
        }
        this._bytesWritten += bytesWritten;
        callback(e);
      });
    }
    if (this._pos !== undefined) {
      this._pos += data.length;
    }
  }

  /**
   * Vectorised write hook for stream implementation.
   */
  public _writev(
    chunks: Array<{ chunk: Buffer }>,
    callback: Callback<[WriteStream]>,
  ): void {
    this._write(
      Buffer.concat(chunks.map((chunk) => chunk.chunk)),
      undefined,
      callback,
    );
    return;
  }

  /**
   * Destroy hook for stream implementation.
   */
  public _destroy(err: Error, callback: Callback): void {
    if (this._fd) {
      this._fs.close(this._fd, (err_) => {
        this._error(err_ || err);
      });
    } else {
      callback(err);
    }
  }

  /**
   * Final hook for stream implementation.
   */
  public _final(callback: Callback): void {
    callback(null);
  }

  /**
   * Custom error handling for stream implementation
   */
  protected _error(err?: Error): void {
    if (err) {
      if (this._autoClose) {
        this.destroy();
      }
      super.emit('error', err);
    }
  }
}

export default WriteStream;
