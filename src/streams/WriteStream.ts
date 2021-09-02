import type { optionsStream } from './types';
import type { FdIndex } from '../fd/types';
import type { EncryptedFS } from '../';

import * as vfs from 'virtualfs';
import { nextTick } from 'process';
import { Writable } from 'stream';

 class WriteStream extends Writable {

  protected _fs: EncryptedFS;
  bytesWritten: number;
  path: string;
  fd?: FdIndex;
  flags: string;
  mode: number;
  autoClose: boolean;
  start?: number;
  pos?: number;
  closed?: boolean;
  destroy: () => {};

  /**
   * Creates WriteStream.
   */
  constructor (path: string, options: optionsStream, fs: EncryptedFS) {
    super({
      highWaterMark: options.highWaterMark
    });
    this._fs = fs;
    this.bytesWritten = 0;
    this.path = path;
    this.fd = options.fd === undefined ? undefined : options.fd;
    this.flags = options.flags === undefined ? 'w' : options.flags;
    this.mode = options.mode === undefined ? vfs.DEFAULT_FILE_PERM : options.mode;
    this.autoClose = options.autoClose === undefined ? true : options.autoClose;
    this.start = options.start;
    this.pos = this.start; // WriteStream maintains its own position
    if (options.encoding) {
      super.setDefaultEncoding(options.encoding);
    }
    if (typeof this.fd !== 'number') {
      this._open();
    }
    super.on('finish', () => {
      if (this.autoClose) {
        this.destroy();
      }
    });
  }

  /**
   * Open file descriptor if WriteStream was constructed from a file path.
   */
  _open () {
    this._fs.open(this.path, this.flags, this.mode, (e, fd) => {
      if (e) {
        if (this.autoClose) {
          this.destroy();
        }
        super.emit('error', e);
        return;
      }
      this.fd = fd;
      super.emit('open', fd);
    });
  }

  /**
   * Asynchronous write hook for stream implementation.
   */
  _write (data: Buffer | string, encoding: string | undefined, cb: Function) {
    if (typeof this.fd !== 'number') {
      return super.once('open', () => {
        this._write(data, encoding, cb);
      });
    }
    this._fs.write(this.fd, data, 0, data.length, this.pos, (e, bytesWritten) => {
      if (e) {
        if (this.autoClose) {
          this.destroy();
        }
        cb(e);
        return;
      }
      this.bytesWritten += bytesWritten;
      cb();
    });
    if (this.pos !== undefined) {
      this.pos += data.length;
    }
  }

  /**
   * Vectorised write hook for stream implementation.
   */
  _writev (chunks:Array<{chunk: Buffer}>, cb: Function) {
    this._write(
      Buffer.concat(chunks.map((chunk) => chunk.chunk)),
      undefined,
      cb
    );
    return;
  }

  /**
   * Destroy hook for stream implementation.
   */
  _destroy (e: Error, cb: Function) {
    this._close((e_) => {
      cb(e || e_);
    });
  }

  /**
   * Close file descriptor if WriteStream was constructed from a file path.
   */
  _close (cb: Function) {
    if (cb) {
      super.once('close', cb);
    }
    if (typeof this.fd !== 'number') {
      super.once('open', () => {
        this._close();
      });
      return;
    }
    if (this.closed) {
      return nextTick(() => super.emit('close'));
    }
    this.closed = true;
    this._fs.close(this.fd, (e) => {
      if (e) {
        this.emit('error', e);
      } else {
        this.emit('close');
      }
    });
    this.fd = undefined;
  }

  /**
   * Final hook for stream implementation.
   */
  _final (cb: Function) {
    cb();
    return;
  }

}

export default WriteStream;
