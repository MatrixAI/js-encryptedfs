/* eslint-disable @typescript-eslint/no-floating-promises */
import type { OptionsStream } from './types';
import type { Callback } from '../types';
import type { FdIndex } from '../fd/types';
import type { EncryptedFS } from '../';
import { Readable } from 'readable-stream';
import * as permissions from '../permissions';

class ReadStream extends Readable {
  protected _bytesRead: number;
  protected _fs: EncryptedFS;
  protected _path: string;
  protected _fd?: FdIndex;
  protected _flags: string;
  protected _mode: number;
  protected _autoClose: boolean;
  protected _end: number;
  protected _pos?: number;
  protected _closed?: boolean;

  /**
   * Creates ReadStream
   * It will asynchronously open the file descriptor if a file path was passed in
   * It will automatically close the opened file descriptor by default
   */
  constructor(path: string, options: OptionsStream, fs: EncryptedFS) {
    super({
      highWaterMark: options.highWaterMark,
      encoding: options.encoding,
    });
    this._fs = fs;
    this._bytesRead = 0;
    this._path = path;
    this._fd = options.fd === undefined ? undefined : options.fd;
    this._flags = options.flags === undefined ? 'r' : options.flags;
    this._mode =
      options.mode === undefined ? permissions.DEFAULT_FILE_PERM : options.mode;
    this._autoClose =
      options.autoClose === undefined ? true : options.autoClose;
    this._end = options.end === undefined ? Infinity : options.end;
    this._pos = options.start;
    if (typeof this._fd !== 'number') {
      this._open();
    }
    super.on('end', () => {
      if (this._autoClose) {
        this.destroy();
      }
    });
  }

  get bytesRead() {
    return this._bytesRead;
  }

  /**
   * Open file descriptor if ReadStream was constructed from a file path
   */
  protected _open(): void {
    this._fs.open(this._path, this._flags, this._mode, (err, fd) => {
      this._error(err);
      this._fd = fd;
      super.emit('open', fd);
    });
  }

  /**
   * Asynchronous read hook for stream implementation
   * The size passed into this function is not the requested size, but the high watermark
   * It's just a heuristic buffering size to avoid sending to many syscalls
   * However since this is an in-memory filesystem, the size itself is irrelevant
   */
  public _read(size: number): void {
    if (typeof this._fd !== 'number') {
      super.once('open', () => {
        this._read(size);
      });
      return;
    }
    if (this.destroyed) return;
    if (this._pos != null) {
      size = Math.min(this._end - this._pos + 1, size);
    }
    if (size <= 0) {
      this.push(null);
      return;
    }
    const buffer = Buffer.allocUnsafe(size);
    if (this._pos) {
      this._fs.read(this._fd, buffer, 0, size, this._pos, (err, bytesRead) => {
        this._error(err);
        if (bytesRead > 0) {
          this._bytesRead += bytesRead;
          this.push(buffer.slice(0, bytesRead));
        } else {
          this.push(null);
        }
      });
    } else {
      this._fs.read(this._fd, buffer, 0, size, (err, bytesRead) => {
        this._error(err);
        if (bytesRead > 0) {
          this._bytesRead += bytesRead;
          this.push(buffer.slice(0, bytesRead));
        } else {
          this.push(null);
        }
      });
    }
    if (this._pos != null) {
      this._pos += size;
    }
  }

  /**
   * Destroy hook for stream implementation
   */
  public _destroy(err: Error, callback: Callback): void {
    if (this._fd) {
      this._fs.close(this._fd, (err_) => {
        this._error(err_ || err);
        callback(err_);
      });
    } else {
      callback(err);
    }
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

export default ReadStream;
