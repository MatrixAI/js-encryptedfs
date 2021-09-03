import type { optionsStream } from './types';
import type { Callback } from '../types';
import type { FdIndex } from '../fd/types';
import type { EncryptedFS } from '../';

import * as vfs from 'virtualfs';
import { Readable } from 'stream';

class ReadStream extends Readable {

  protected _fs: EncryptedFS;
  protected bytesRead: number;
  protected path: string;
  protected fd?: FdIndex;
  protected flags: string;
  protected mode: number;
  protected autoClose: boolean;
  protected end: number;
  protected pos?: number;
  protected closed?: boolean;

  /**
   * Creates ReadStream
   * It will asynchronously open the file descriptor if a file path was passed in
   * It will automatically close the opened file descriptor by default
   */
  constructor (path: string, options: optionsStream, fs: EncryptedFS) {
    super({
      highWaterMark: options.highWaterMark,
      encoding: options.encoding
    });
    this._fs = fs;
    this.bytesRead = 0;
    this.path = path;
    this.fd = (options.fd === undefined) ? undefined : options.fd;
    this.flags = (options.flags === undefined) ? 'r' : options.flags;
    this.mode = (options.mode === undefined) ? vfs.DEFAULT_FILE_PERM : options.mode;
    this.autoClose = (options.autoClose === undefined) ? true : options.autoClose;
    this.end = (options.end === undefined) ? Infinity : options.end;
    this.pos = options.start;
    if (typeof this.fd !== 'number') {
      this._open();
    }
    super.on('end', () => {
      if (this.autoClose) {
        this.destroy();
      }
    });
  }

  /**
   * Open file descriptor if ReadStream was constructed from a file path
   */
  protected _open(): void {
    this._fs.open(this.path, this.flags, this.mode, (err, fd) => {
      this._error(err);
      this.fd = fd;
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
    if (typeof this.fd !== 'number') {
      super.once('open', () => {
        this._read(size);
      });
      return;
    }
    if (this.destroyed) return;
    if (this.pos != null) {
      size = Math.min(this.end - this.pos + 1, size);
    }
    if (size <= 0) {
      this.push(null);
      return;
    }
    const buffer = Buffer.allocUnsafe(size);
    if (this.pos) {
      this._fs.read(
        this.fd,
        buffer,
        0,
        size,
        this.pos,
        (err, bytesRead) => {
          this._error(err);
          if (bytesRead > 0) {
            this.bytesRead += bytesRead;
            this.push(buffer.slice(0, bytesRead));
          } else {
            this.push(null);
          }
        }
      );
    } else {
      this._fs.read(
        this.fd,
        buffer,
        0,
        size,
        (err, bytesRead) => {
          this._error(err);
          if (bytesRead > 0) {
            this.bytesRead += bytesRead;
            this.push(buffer.slice(0, bytesRead));
          } else {
            this.push(null);
          }
        }
      );
    }
    if (this.pos != null) {
      this.pos += size;
    }
  }

  /**
   * Destroy hook for stream implementation
   */
  public _destroy(err: Error, callback: Callback): void {
    if (this.fd) {
      this._fs.close(this.fd, (err_) => {
        this._error(err_ || err);
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
      if (this.autoClose) {
        this.destroy();
      }
      super.emit('error', err);
    }
  }

}

export default ReadStream;
