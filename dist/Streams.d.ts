/// <reference types="node" />
import EncryptedFS from './EncryptedFS';
import { Readable, Writable } from 'readable-stream';
declare type optionsStream = {
    highWaterMark?: number;
    flags?: string;
    encoding?: BufferEncoding;
    fd?: number | null;
    mode?: number;
    autoClose?: boolean;
    start?: number;
    end?: number;
};
/**
 * Class representing a ReadStream.
 * @extends Readable
 */
declare class ReadStream extends Readable {
    private efs;
    bytesRead: number;
    path: string;
    fd: number | null | undefined;
    flags: string;
    mode: number | undefined;
    autoClose: boolean;
    start: number | undefined;
    end: number;
    pos: number;
    closed: boolean;
    /**
     * Creates ReadStream.
     * It will asynchronously open the file descriptor if a file path was passed in.
     * It will automatically close the opened file descriptor by default.
     */
    constructor(path: string, options: optionsStream, fileSystem: EncryptedFS);
    /**
     * Open file descriptor if ReadStream was constructed from a file path.
     * @private
     */
    _open(): void;
    /**
     * Asynchronous read hook for stream implementation.
     * The size passed into this function is not the requested size, but the high watermark.
     * It's just a heuristic buffering size to avoid sending to many syscalls.
     * However since this is an in-memory filesystem, the size itself is irrelevant.
     * @private
     */
    _read(size: number): void;
    /**
     * Destroy hook for stream implementation.
     * @private
     */
    _destroy(e: Error, cb: Function): void;
    /**
     * Close file descriptor if ReadStream was constructed from a file path.
     * @private
     */
    _close(cb: any): Promise<unknown> | undefined;
}
/**
 * Class representing a WriteStream.
 * @extends Writable
 */
declare class WriteStream extends Writable {
    private efs;
    bytesWritten: number;
    path: string;
    fd: number | null | undefined;
    flags: string;
    mode: number | undefined;
    autoClose: boolean;
    start: number | undefined;
    pos: number | undefined;
    closed: boolean | undefined;
    /**
     * Creates WriteStream.
     */
    constructor(path: string, options: optionsStream, fs: EncryptedFS);
    /**
     * Open file descriptor if WriteStream was constructed from a file path.
     * @private
     */
    _open(): void;
    /**
     * Asynchronous write hook for stream implementation.
     * @private
     */
    _write(data: Buffer | string, encoding: string | undefined, cb: Function): this | undefined;
    /**
     * Vectorised write hook for stream implementation.
     * @private
     */
    _writev(chunks: Array<{
        chunk: Buffer;
    }>, cb: Function): void;
    /**
     * Destroy hook for stream implementation.
     * @private
     */
    _destroy(e: Error, cb: Function): void;
    /**
     * Close file descriptor if WriteStream was constructed from a file path.
     * @private
     */
    _close(cb: any): Promise<unknown> | undefined;
    /**
     * Final hook for stream implementation.
     * @private
     */
    _final(cb: Function): void;
}
export { optionsStream, ReadStream, WriteStream };
