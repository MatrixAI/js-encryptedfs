"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const readable_stream_1 = require("readable-stream");
const constants_1 = require("./constants");
/**
 * Class representing a ReadStream.
 * @extends Readable
 */
class ReadStream extends readable_stream_1.Readable {
    /**
     * Creates ReadStream.
     * It will asynchronously open the file descriptor if a file path was passed in.
     * It will automatically close the opened file descriptor by default.
     */
    constructor(path, options, fileSystem) {
        var _a;
        super({
            highWaterMark: options.highWaterMark,
            encoding: options.encoding,
        });
        this.efs = fileSystem;
        this.bytesRead = 0;
        this.path = path;
        this.fd = options.fd === undefined ? null : options.fd;
        this.flags = options.flags === undefined ? 'r' : options.flags;
        this.mode = options.mode === undefined ? constants_1.DEFAULT_FILE_PERM : options.mode;
        this.autoClose = options.autoClose === undefined ? true : options.autoClose;
        this.start = options.start;
        this.end = options.end === undefined ? Infinity : options.end;
        this.pos = (_a = options.start) !== null && _a !== void 0 ? _a : 0;
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
     * Open file descriptor if ReadStream was constructed from a file path.
     * @private
     */
    _open() {
        this.efs.promises
            .open(this.path, this.flags, this.mode)
            .then((fd) => {
            this.fd = fd;
            super.emit('open', fd);
            super.read();
        })
            .catch((err) => {
            if (this.autoClose) {
                this.destroy();
            }
            super.emit('error', err);
            return;
        });
    }
    /**
     * Asynchronous read hook for stream implementation.
     * The size passed into this function is not the requested size, but the high watermark.
     * It's just a heuristic buffering size to avoid sending to many syscalls.
     * However since this is an in-memory filesystem, the size itself is irrelevant.
     * @private
     */
    _read(size) {
        if (typeof this.fd !== 'number') {
            super.once('open', () => {
                this._read(size);
            });
            return;
        }
        if (this.destroyed) {
            return;
        }
        // this.pos is only ever used if this.start is specified
        if (this.pos != null && this.end !== Infinity) {
            size = Math.min(this.end - this.pos + 1, size);
        }
        if (size <= 0) {
            this.push(null);
            return;
        }
        const buffer = Buffer.allocUnsafe(size);
        this.efs.promises
            .read(this.fd, buffer, 0, size, this.pos)
            .then((bytesRead) => {
            if (bytesRead > 0) {
                this.bytesRead += bytesRead;
                this.push(buffer.slice(0, bytesRead));
            }
            else {
                this.push(null);
            }
        })
            .catch((err) => {
            if (this.autoClose) {
                this.destroy();
            }
            super.emit('error', err);
        });
        if (this.pos != null) {
            this.pos += size;
        }
    }
    /**
     * Destroy hook for stream implementation.
     * @private
     */
    _destroy(e, cb) {
        this._close((e_) => {
            cb(e || e_);
        });
    }
    /**
     * Close file descriptor if ReadStream was constructed from a file path.
     * @private
     */
    _close(cb) {
        if (cb) {
            super.once('close', cb);
        }
        if (typeof this.fd !== 'number') {
            super.once('open', () => {
                this._close(null);
            });
            return;
        }
        if (this.closed) {
            return new Promise(() => super.emit('close'));
        }
        this.closed = true;
        this.efs.promises
            .close(this.fd)
            .then(() => {
            this.emit('close');
        })
            .catch((err) => {
            this.emit('error', err);
        });
        this.fd = null;
    }
}
exports.ReadStream = ReadStream;
/**
 * Class representing a WriteStream.
 * @extends Writable
 */
class WriteStream extends readable_stream_1.Writable {
    /**
     * Creates WriteStream.
     */
    constructor(path, options, fs) {
        var _a;
        super({
            highWaterMark: options.highWaterMark,
        });
        this.efs = fs;
        this.bytesWritten = 0;
        this.path = path;
        this.fd = options.fd === undefined ? null : options.fd;
        this.flags = options.flags === undefined ? 'w' : options.flags;
        this.mode = options.mode === undefined ? constants_1.DEFAULT_FILE_PERM : options.mode;
        this.autoClose = options.autoClose === undefined ? true : options.autoClose;
        this.start = (_a = options.start) !== null && _a !== void 0 ? _a : 0;
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
     * @private
     */
    _open() {
        this.efs.promises
            .open(this.path, this.flags, this.mode)
            .then((fd) => {
            this.fd = fd;
            super.emit('open', fd);
            // super.read();
        })
            .catch((err) => {
            if (this.autoClose) {
                this.destroy();
            }
            super.emit('error', err);
            return;
        });
    }
    /**
     * Asynchronous write hook for stream implementation.
     * @private
     */
    // $FlowFixMe: _write hook adapted from Node `lib/internal/fs/streams.js`
    _write(data, encoding, cb) {
        if (typeof this.fd !== 'number') {
            return super.once('open', () => {
                this._write(data, encoding, cb);
            });
        }
        let internalData;
        if (typeof data === 'string') {
            internalData = Buffer.from(data);
        }
        else {
            internalData = data;
        }
        this.efs.promises
            .write(this.fd, internalData, 0, data.length, this.pos)
            .then((bytesWritten) => {
            this.bytesWritten += bytesWritten;
            cb();
        })
            .catch((err) => {
            if (this.autoClose) {
                this.destroy();
            }
            cb(err);
        });
        if (this.pos !== undefined) {
            this.pos += data.length;
        }
    }
    /**
     * Vectorised write hook for stream implementation.
     * @private
     */
    _writev(chunks, cb) {
        this._write(Buffer.concat(chunks.map((chunk) => chunk.chunk)), undefined, cb);
        return;
    }
    /**
     * Destroy hook for stream implementation.
     * @private
     */
    _destroy(e, cb) {
        this._close((e_) => {
            cb(e || e_);
        });
    }
    /**
     * Close file descriptor if WriteStream was constructed from a file path.
     * @private
     */
    _close(cb) {
        if (cb) {
            super.once('close', cb);
        }
        if (typeof this.fd !== 'number') {
            super.once('open', () => {
                this._close(null);
            });
            return;
        }
        if (this.closed) {
            return new Promise(() => super.emit('close'));
        }
        this.closed = true;
        this.efs.promises
            .close(this.fd)
            .then(() => {
            this.emit('close');
        })
            .catch((err) => {
            this.emit('error', err);
        });
        this.fd = null;
    }
    /**
     * Final hook for stream implementation.
     * @private
     */
    _final(cb) {
        cb();
        return;
    }
}
exports.WriteStream = WriteStream;
//# sourceMappingURL=Streams.js.map