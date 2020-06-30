/// <reference types="node" />
import fs from 'fs';
import { ModuleThread, Pool } from 'threads';
import { optionsStream, ReadStream, WriteStream } from './Streams';
import { EncryptedFSCryptoWorker } from './EncryptedFSCryptoWorker';
import { CryptoInterface } from './EncryptedFSCrypto';
/**
 * Encrypted filesystem written in TypeScript for Node.js.
 * @param key A key.
 * @param upperDir The upper directory file system.
 * @param lowerDir The lower directory file system.
 * @param initVectorSize The size of the initial vector, defaults to 16.
 * @param blockSize The size of block, defaults to 4096.
 * @param useWebWorkers Use webworkers to make crypto tasks true async, defaults to false.
 */
declare class EncryptedFS {
    private uid;
    private gid;
    private umask;
    private upperDir;
    private upperDirContextControl;
    private lowerDir;
    private lowerDirContextControl;
    private crypto;
    private chunkSize;
    private blockSize;
    private fileDescriptors;
    private masterKey;
    private metadata;
    constants: any;
    constructor(key: Buffer | string, upperDir: typeof fs, upperDirContextControl: typeof fs, lowerDir: typeof fs, lowerDirContextControl: typeof process, umask?: number, blockSize?: number, useWebWorkers?: boolean, cryptoLib?: CryptoInterface | undefined, workerPool?: Pool<ModuleThread<EncryptedFSCryptoWorker>>);
    promises: {
        /**
         * Asynchronously tests a user's permissions for the file specified by path.
         * @param fd number. File descriptor.
         * @returns Promise<void>.
         */
        access: (path: fs.PathLike, mode?: number) => Promise<void>;
        /**
         * Asynchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
         * @param path string. Path to create.
         * @returns void.
         */
        lstat: (path: fs.PathLike) => Promise<fs.Stats>;
        /**
         * Asynchronously makes the directory in the upper file system directory. Propagates upper fs method.
         * @param path string. Path to create.
         * @param mode number | undefined. Permissions or mode.
         * @returns void.
         */
        mkdir: (path: fs.PathLike, options?: fs.MakeDirectoryOptions) => Promise<string>;
        /**
         * Asynchronously makes a temporary directory with the prefix given.
         * @param prefix string. Prefix of temporary directory.
         * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
         * @returns void.
         */
        mkdtemp: (prefix: string, options?: {
            encoding: BufferEncoding;
        } | "ascii" | "utf8" | "utf-8" | "utf16le" | "ucs2" | "ucs-2" | "base64" | "latin1" | "binary" | "hex" | null | undefined) => Promise<string>;
        /**
         * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
         * @param path string.
         * @returns void.
         */
        stat: (path: fs.PathLike) => Promise<fs.Stats>;
        /**
         * Asynchronously removes the directory in the upper file system directory. Propagates upper fs method.
         * @param path string. Path to create.
         * @param options: { recursive: boolean }.
         * @returns void.
         */
        rmdir: (path: fs.PathLike, options?: fs.RmDirAsyncOptions | undefined) => Promise<void>;
        /**
         * Asynchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
         * @param target string. Destination path.
         * @param path string. Source path.
         * @returns void.
         */
        symlink: (target: fs.PathLike, path: fs.PathLike, type: "dir" | "file" | "junction" | null | undefined) => Promise<void>;
        /**
         * Asynchronously changes the size of the file by len bytes.
         * @param dstPath string. Destination path.
         * @param srcPath string. Source path.
         * @returns void.
         */
        truncate: (file: string | number | Buffer | import("url").URL, len?: number) => Promise<void>;
        /**
         * Asynchronously unlinks the given path in the upper and lower file system directories.
         * @param path string. Path to create.
         * @returns void.
         */
        unlink: (path: fs.PathLike) => Promise<void>;
        /**
         * Asynchronously changes the access and modification times of the file referenced by path.
         * @param path string. Path to file.
         * @param atime number | string | Date. Access time.
         * @param mtime number | string | Date. Modification time.
         * @returns void.
         */
        utimes: (path: fs.PathLike, atime: string | number | Date, mtime: string | number | Date) => Promise<void>;
        /**
         * Asynchronously closes the file descriptor.
         * @param fd number. File descriptor.
         * @returns Promise<void>.
         */
        close: (fd: number) => Promise<void>;
        /**
         * Asynchronously writes buffer (with length) to the file descriptor at an offset and position.
         * @param path string. Path to directory to be read.
         * @param options FileOptions.
         * @returns string[] (directory contents).
         */
        readdir: (path: fs.PathLike, options?: {
            encoding: BufferEncoding;
            withFileTypes?: false | undefined;
        } | undefined) => Promise<string[]>;
        /**
         * Asynchronously checks if path exists.
         * @param path string.
         * @returns boolean.
         */
        exists: (path: fs.PathLike) => Promise<boolean>;
        /**
         * Asynchronously manipulates the allocated disk space for a file.
         * @param fdIndex number. File descriptor index.
         * @param offset number. Offset to start manipulations from.
         * @param len number. New length for the file.
         * @returns void.
         */
        fallocate: (fdIndex: number, offset: number, len: number) => Promise<void>;
        /**
         * Asynchronously changes the permissions of the file referred to by fdIndex.
         * @param fdIndex number. File descriptor index.
         * @param mode number. New permissions set.
         * @returns void.
         */
        fchmod: (fdIndex: number, mode?: number) => Promise<void>;
        /**
         * Asynchronously changes the owner or group of the file referred to by fdIndex.
         * @param fdIndex number. File descriptor index.
         * @param uid number. User identifier.
         * @param gid number. Group identifier.
         * @returns void.
         */
        fchown: (fdIndex: number, uid: number, gid: number) => Promise<void>;
        /**
         * Asynchronously flushes in memory data to disk. Not required to update metadata.
         * @param fdIndex number. File descriptor index.
         * @returns void.
         */
        fdatasync: (fdIndex: number) => Promise<void>;
        /**
         * Asynchronously retrieves data about the file described by fdIndex.
         * @param fd number. File descriptor.
         * @returns void.
         */
        fstat: (fd: number) => Promise<fs.Stats>;
        /**
         * Asynchronously flushes all modified data to disk.
         * @param fdIndex number. File descriptor index.
         * @returns void.
         */
        fsync: (fdIndex: number) => Promise<void>;
        /**
         * Asynchronously truncates to given length.
         * @param fdIndex number. File descriptor index
         * @param len number. Length to truncate to.
         * @returns void.
         */
        ftruncate: (fdIndex: number, len?: number) => Promise<void>;
        /**
         * Asynchronously changes the access and modification times of the file referenced by fdIndex.
         * @param fdIndex number. File descriptor index
         * @param atime number | string | Date. Access time.
         * @param mtime number | string | Date. Modification time.
         * @returns void.
         */
        futimes: (fdIndex: number, atime: string | number | Date, mtime: string | number | Date) => Promise<void>;
        /**
         * Asynchronously links a path to a new path.
         * @param existingPath string.
         * @param newPath string.
         * @returns void.
         */
        link: (existingPath: fs.PathLike, newPath: fs.PathLike) => Promise<void>;
        /**
         * Asynchronously reads data from a file given the path of that file.
         * @param path string. Path to file.
         * @returns void.
         */
        readFile: (path: string | number | Buffer | import("url").URL, options?: string | {
            encoding?: string | null | undefined;
            mode?: string | number | undefined;
            flag?: string | undefined;
        } | null | undefined) => Promise<string | Buffer>;
        /**
         * Asynchronously reads link of the given the path. Propagated from upper fs.
         * @param path string. Path to file.
         * @param options FileOptions | undefined.
         * @returns Buffer | string.
         */
        readlink: (path: fs.PathLike, options: fs.WriteFileOptions) => Promise<string | Buffer>;
        /**
         * Asynchronously determines the actual location of path. Propagated from upper fs.
         * @param path string. Path to file.
         * @param options FileOptions | undefined.
         * @returns void.
         */
        realpath: (path: fs.PathLike, options: fs.WriteFileOptions) => Promise<string>;
        /**
         * Asynchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
         * @param oldPath string. Old path.
         * @param oldPath string. New path.
         * @returns void.
         */
        rename: (oldPath: fs.PathLike, newPath: fs.PathLike) => Promise<void>;
        /**
         * Asynchronously reads data at an offset, position and length from a file descriptor into a given buffer.
         * @param fd number. File descriptor.
         * @param buffer Buffer. Buffer to be written from.
         * @param offset number. The offset in the buffer at which to start writing.
         * @param length number. The number of bytes to read.
         * @param position number. The offset from the beginning of the file from which data should be read.
         * @returns Promise<number> (bytes read).
         */
        read: (fd: number, buffer: Buffer, offset?: number, length?: number, position?: number) => Promise<number>;
        /**
         * Asynchronously writes buffer (with length) to the file descriptor at an offset and position.
         * @param fd number. File descriptor.
         * @param buffer Buffer. Buffer to be written from.
         * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
         * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
         * @param position number. The offset from the beginning of the file where this data should be written.
         * @returns Promise<number>.
         */
        write: (fd: number, buffer: Buffer, offset?: number, length?: number, position?: number) => Promise<number>;
        /**
         * Asynchronously append data to a file, creating the file if it does not exist.
         * @param file string | number. Path to the file or directory.
         * @param data string | Buffer. The data to be appended.
         * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
         * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
         * @returns Promise<void>.
         */
        appendFile: (file: string | number | Buffer | import("url").URL, data: Buffer, options?: string | {
            encoding?: string | null | undefined;
            mode?: string | number | undefined;
            flag?: string | undefined;
        } | null | undefined) => Promise<void>;
        /**
         * Asynchronously changes the access permissions of the file system object described by path.
         * @param path string. Path to the fs object.
         * @param mode number. New permissions set.
         * @returns void.
         */
        chmod: (path: fs.PathLike, mode?: number) => Promise<void>;
        /**
         * Asynchronously changes the owner or group of the file system object described by path.
         * @param path string. Path to the fs object.
         * @param uid number. User identifier.
         * @param gid number. Group identifier.
         * @returns void.
         */
        chown: (path: fs.PathLike, uid: number, gid: number) => Promise<void>;
        /**
         * Asynchronously writes data to the path specified with some FileOptions.
         * @param path string | number. Path to the file or directory.
         * @param data string | Buffer. The data to be written.
         * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined } | undefined
         * @returns void.
         */
        writeFile: (path: string | number | Buffer | import("url").URL, data: string | Buffer, options: fs.WriteFileOptions) => Promise<void>;
        /**
         * Asynchronously opens a file or directory and returns the file descriptor.
         * @param path string. Path to the file or directory.
         * @param flags string. Flags for read/write operations. Defaults to 'r'.
         * @param mode number. Read and write permissions. Defaults to 0o666.
         * @returns Promise<number>
         */
        open: (path: fs.PathLike, flags?: string | number, mode?: string | number) => Promise<number>;
    };
    getUmask(): number;
    setUmask(umask: number): void;
    getUid(): number;
    setUid(uid: number): void;
    getGid(): number;
    setGid(gid: number): void;
    getCwd(): string;
    chdir(path: string): void;
    /**
     * Asynchronously tests a user's permissions for the file specified by path.
     * @param fd File descriptor.
     */
    private accessAsync;
    /**
     * Tests a user's permissions for the file specified by path.
     * @param fd File descriptor.
     */
    access(path: fs.PathLike, mode?: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously tests a user's permissions for the file specified by path.
     * @param fd File descriptor.
     */
    accessSync(path: fs.PathLike, mode?: number): void;
    /**
     * Asynchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     */
    private lstatAsync;
    /**
     * Retrieves the path stats in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     */
    lstat(path: fs.PathLike, callback?: (err: Error | null, stats: fs.Stats | null) => void): void;
    /**
     * Synchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     */
    lstatSync(path: fs.PathLike): fs.Stats;
    /**
     * Asynchronously makes the directory in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     * @param mode number | undefined. Permissions or mode.
     */
    private mkdirAsync;
    /**
     * Makes the directory in the upper file system directory. Propagates upper fs method.
     */
    mkdir(path: fs.PathLike, options?: fs.MakeDirectoryOptions, callback?: (err: Error | null, path: string | null) => void): void;
    /**
     * Synchronously makes the directory in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     * @param mode number | undefined. Permissions or mode.
     */
    mkdirSync(path: fs.PathLike, options?: fs.MakeDirectoryOptions): void;
    /**
     * Asynchronously makes a temporary directory with the prefix given.
     * @param prefix Prefix of temporary directory.
     * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
     */
    private mkdtempAsync;
    /**
     * Makes a temporary directory with the prefix given.
     * @param prefix Prefix of temporary directory.
     * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
     */
    mkdtemp(prefix: string, options?: {
        encoding: BufferEncoding;
    } | BufferEncoding | null | undefined, callback?: (err: Error | null, path: string | null) => void): void;
    /**
     * Synchronously makes a temporary directory with the prefix given.
     * @param prefix Prefix of temporary directory.
     * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
     */
    mkdtempSync(prefix: string, options?: {
        encoding: BufferEncoding;
    } | BufferEncoding | null | undefined): string;
    /**
     * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
     */
    private statAsync;
    /**
     * Retrieves  in the upper file system directory. Propagates upper fs method.
     */
    stat(path: fs.PathLike, callback?: (err: Error | null, stats: fs.Stats | null) => void): void;
    /**
     * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
     */
    statSync(path: fs.PathLike): fs.Stats;
    /**
     * Asynchronously removes the directory in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     * @param options: { recursive: boolean }.
     */
    private rmdirAsync;
    /**
     * Removes the directory in the upper file system directory. Propagates upper fs method.
     */
    rmdir(path: fs.PathLike, options?: fs.RmDirAsyncOptions | undefined, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously removes the directory in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     * @param options: { recursive: boolean }.
     */
    rmdirSync(path: fs.PathLike, options?: fs.RmDirOptions | undefined): void;
    /**
     * Asynchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
     * @param target Destination path.
     * @param path Source path.
     */
    private symlinkAsync;
    /**
     * Creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
     * @param target Destination path.
     * @param path Source path.
     */
    symlink(target: fs.PathLike, path: fs.PathLike, type: 'dir' | 'file' | 'junction' | null | undefined, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
     * @param dstPath Destination path.
     * @param srcPath Source path.
     */
    symlinkSync(target: fs.PathLike, path: fs.PathLike, type?: 'dir' | 'file' | 'junction' | null | undefined): void;
    /**
     * Asynchronously changes the size of the file by len bytes.
     */
    private truncateAsync;
    /**
     * Changes the size of the file by len bytes.
     */
    truncate(file: fs.PathLike | number, len?: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously changes the size of the file by len bytes.
     */
    truncateSync(file: fs.PathLike | number, len?: number): void;
    /**
     * Asynchronously unlinks the given path in the upper and lower file system directories.
     * @param path Path to create.
     */
    private unlinkAsync;
    /**
     * Unlinks the given path in the upper and lower file system directories.
     * @param path Path to create.
     */
    unlink(path: fs.PathLike, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously unlinks the given path in the upper and lower file system directories.
     * @param path Path to create.
     */
    unlinkSync(path: fs.PathLike): void;
    /**
     * Asynchronously changes the access and modification times of the file referenced by path.
     * @param path Path to file.
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    private utimesAsync;
    /**
     * Changes the access and modification times of the file referenced by path.
     * @param path Path to file.
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    utimes(path: fs.PathLike, atime: number | string | Date, mtime: number | string | Date, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously changes the access and modification times of the file referenced by path.
     * @param path Path to file.
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    utimesSync(path: fs.PathLike, atime: number | string | Date, mtime: number | string | Date): void;
    /**
     * Asynchronously closes the file descriptor.
     * @param fd number. File descriptor.
     */
    private closeAsync;
    /**
     * Closes the file descriptor.
     * @param fd number. File descriptor.
     */
    close(fd: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously closes the file descriptor.
     * @param fd number. File descriptor.
     */
    closeSync(fd: number): void;
    /**
     * Asynchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param path Path to directory to be read.
     * @param options FileOptions.
     */
    private readdirAsync;
    /**
     * Writes buffer (with length) to the file descriptor at an offset and position.
     * @param path Path to directory to be read.
     * @param options FileOptions.
     */
    readdir(path: fs.PathLike, options?: {
        encoding: BufferEncoding;
        withFileTypes?: false;
    }, callback?: (err: Error | null, contents: string[] | null) => void): void;
    /**
     * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param path Path to directory to be read.
     * @param options FileOptions.
     */
    readdirSync(path: fs.PathLike, options?: {
        encoding: BufferEncoding;
        withFileTypes?: false;
    }): string[];
    /**
     * Creates a read stream from the given path and options.
     * @param path
     */
    createReadStream(path: fs.PathLike, options: optionsStream | undefined): ReadStream;
    /**
     * Creates a write stream from the given path and options.
     * @param path
     */
    createWriteStream(path: fs.PathLike, options: optionsStream | undefined): WriteStream;
    /**
     * Asynchronously checks if path exists.
     * @param path
     */
    private existsAsync;
    /**
     * Checks if path exists.
     * @param path
     */
    exists(path: fs.PathLike, callback?: (err: Error | null, exists: boolean | null) => void): void;
    /**
     * Synchronously checks if path exists.
     * @param path
     */
    existsSync(path: fs.PathLike): boolean;
    /**
     * Asynchronously manipulates the allocated disk space for a file.
     * @param fdIndex number. File descriptor index.
     * @param offset number. Offset to start manipulations from.
     * @param len number. New length for the file.
     */
    private fallocateAsync;
    /**
     * Manipulates the allocated disk space for a file.
     * @param fdIndex number. File descriptor index.
     * @param offset number. Offset to start manipulations from.
     * @param len number. New length for the file.
     */
    fallocate(fdIndex: number, offset: number, len: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously manipulates the allocated disk space for a file.
     * @param fdIndex number. File descriptor index.
     * @param offset number. Offset to start manipulations from.
     * @param len number. New length for the file.
     */
    fallocateSync(fdIndex: number, offset: number, len: number): void;
    /**
     * Asynchronously changes the permissions of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param mode number. New permissions set.
     */
    private fchmodAsync;
    /**
     * Changes the permissions of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param mode number. New permissions set.
     */
    fchmod(fdIndex: number, mode?: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously changes the permissions of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param mode number. New permissions set.
     */
    fchmodSync(fdIndex: number, mode?: number): void;
    /**
     * Asynchronously changes the owner or group of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    private fchownAsync;
    /**
     * Changes the owner or group of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    fchown(fdIndex: number, uid: number, gid: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously changes the owner or group of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    fchownSync(fdIndex: number, uid: number, gid: number): void;
    /**
     * Asynchronously flushes in memory data to disk. Not required to update metadata.
     * @param fdIndex number. File descriptor index.
     */
    private fdatasyncAsync;
    /**
     * Flushes in memory data to disk. Not required to update metadata.
     * @param fdIndex number. File descriptor index.
     */
    fdatasync(fdIndex: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously flushes in memory data to disk. Not required to update metadata.
     * @param fdIndex number. File descriptor index.
     */
    fdatasyncSync(fdIndex: number): void;
    /**
     * Asynchronously retrieves data about the file described by fdIndex.
     * @param fd number. File descriptor.
     */
    private fstatAsync;
    /**
     * Retrieves data about the file described by fdIndex.
     * @param fd number. File descriptor.
     */
    fstat(fd: number, callback?: (err: Error | null, stats: fs.Stats | null) => void): void;
    /**
     * Synchronously retrieves data about the file described by fdIndex.
     * @param fd number. File descriptor.
     */
    fstatSync(fd: number): fs.Stats;
    /**
     * Asynchronously flushes all modified data to disk.
     * @param fdIndex number. File descriptor index.
     */
    private fsyncAsync;
    /**
     * Flushes all modified data to disk.
     * @param fdIndex number. File descriptor index.
     */
    fsync(fdIndex: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously flushes all modified data to disk.
     * @param fdIndex number. File descriptor index.
     */
    fsyncSync(fdIndex: number): void;
    /**
     * Asynchronously truncates to given length.
     * @param fdIndex number. File descriptor index
     * @param len number. Length to truncate to.
     */
    private ftruncateAsync;
    /**
     * Truncates to given length.
     * @param fdIndex number. File descriptor index
     * @param len number. Length to truncate to.
     */
    ftruncate(fdIndex: number, len?: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously truncates to given length.
     * @param fdIndex number. File descriptor index
     * @param len number. Length to truncate to.
     */
    ftruncateSync(fdIndex: number, len?: number): void;
    /**
     * Asynchronously changes the access and modification times of the file referenced by fdIndex.
     * @param fdIndex number. File descriptor index
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    private futimesAsync;
    /**
     * Changes the access and modification times of the file referenced by fdIndex.
     * @param fdIndex number. File descriptor index
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    futimes(fdIndex: number, atime: number | string | Date, mtime: number | string | Date, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously changes the access and modification times of the file referenced by fdIndex.
     * @param fdIndex number. File descriptor index
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    futimesSync(fdIndex: number, atime: number | string | Date, mtime: number | string | Date): void;
    /**
     * Asynchronously links a path to a new path.
     * @param existingPath
     * @param newPath
     */
    private linkAsync;
    /**
     * Links a path to a new path.
     * @param existingPath
     * @param newPath
     */
    link(existingPath: fs.PathLike, newPath: fs.PathLike, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously links a path to a new path.
     * @param existingPath
     * @param newPath
     */
    linkSync(existingPath: fs.PathLike, newPath: fs.PathLike): void;
    /**
     * Asynchronously reads data from a file given the path of that file.
     * @param path Path to file.
     */
    private readFileAsync;
    /**
     * Reads data from a file given the path of that file.
     * @param path Path to file.
     */
    readFile(path: fs.PathLike | number, options: fs.WriteFileOptions, callback?: (err: Error | null, s: string | Buffer | null) => void): void;
    /**
     * Synchronously reads data from a file given the path of that file.
     * @param path Path to file.
     */
    readFileSync(path: fs.PathLike | number, options?: fs.WriteFileOptions): string | Buffer;
    /**
     * Synchronously reads link of the given the path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    private readlinkAsync;
    /**
     * Reads link of the given the path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    readlink(path: fs.PathLike, options: fs.WriteFileOptions, callback?: (err: Error | null, data: string | Buffer | null) => void): void;
    /**
     * Synchronously reads link of the given the path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    readlinkSync(path: fs.PathLike, options: fs.WriteFileOptions): string | Buffer;
    /**
     * Asynchronously determines the actual location of path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    private realpathAsync;
    /**
     * Determines the actual location of path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    realpath(path: fs.PathLike, options: fs.WriteFileOptions, callback?: (err: Error | null, path: string | null) => void): void;
    /**
     * Synchronously determines the actual location of path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    realpathSync(path: fs.PathLike, options?: fs.WriteFileOptions | undefined): string | Buffer;
    /**
     * Asynchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
     * @param oldPath Old path.
     * @param newPath New path.
     */
    private renameAsync;
    /**
     * Renames the file system object described by oldPath to the given new path. Propagated from upper fs.
     * @param oldPath Old path.
     * @param newPath New path.
     */
    rename(oldPath: fs.PathLike, newPath: fs.PathLike, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
     * @param oldPath Old path.
     * @param newPath New path.
     */
    renameSync(oldPath: fs.PathLike, newPath: fs.PathLike): void;
    /**
     * Asynchronously reads data at an offset, position and length from a file descriptor into a given buffer.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The offset in the buffer at which to start writing.
     * @param length number. The number of bytes to read.
     * @param position number. The offset from the beginning of the file from which data should be read.
     */
    private readAsync;
    /**
     * Reads data at an offset, position and length from a file descriptor into a given buffer.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The offset in the buffer at which to start writing.
     * @param length number. The number of bytes to read.
     * @param position number. The offset from the beginning of the file from which data should be read.
     */
    read(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number, callback?: (err: Error | null, bytesRead: number | null) => void): void;
    /**
     * Synchronously reads data at an offset, position and length from a file descriptor into a given buffer.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be read into.
     * @param offset number. The offset in the buffer at which to start writing.
     * @param length number. The number of bytes to read.
     * @param position number. The offset from the beginning of the file from which data should be read.
     */
    readSync(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number): number;
    /**
     * Asynchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
     * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
     * @param position number. The offset from the beginning of the file where this data should be written.
     */
    private writeAsync;
    /**
     * Writes buffer (with length) to the file descriptor at an offset and position.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
     * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
     * @param position number. The offset from the beginning of the file where this data should be written.
     */
    write(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number, callback?: (err: Error | null, bytesWritten: number | null) => void): void;
    /**
     * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
     * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
     * @param position number. The offset from the beginning of the file where this data should be written.
     */
    writeSync(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number): number;
    /**
     * Asynchronously append data to a file, creating the file if it does not exist.
     * @param file string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be appended.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     */
    private appendFileAsync;
    /**
     * Append data to a file, creating the file if it does not exist.
     * @param file string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be appended.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     */
    appendFile(file: fs.PathLike | number, data: Buffer, options: fs.WriteFileOptions, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously append data to a file, creating the file if it does not exist.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be appended.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     */
    appendFileSync(file: fs.PathLike | number, data: Buffer, options?: fs.WriteFileOptions): void;
    /**
     * Asynchronously changes the access permissions of the file system object described by path.
     * @param path Path to the fs object.
     * @param mode number. New permissions set.
     */
    private chmodAsync;
    /**
     * Changes the access permissions of the file system object described by path.
     * @param path Path to the fs object.
     * @param mode number. New permissions set.
     */
    chmod(path: fs.PathLike, mode?: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously changes the access permissions of the file system object described by path.
     * @param path Path to the fs object.
     * @param mode number. New permissions set.
     */
    chmodSync(path: fs.PathLike, mode?: number): void;
    /**
     * Asynchronously changes the owner or group of the file system object described by path.
     * @param path Path to the fs object.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    private chownAsync;
    /**
     * Changes the owner or group of the file system object described by path.
     * @param path Path to the fs object.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    chown(path: fs.PathLike, uid: number, gid: number, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously changes the owner or group of the file system object described by path.
     * @param path Path to the fs object.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    chownSync(path: fs.PathLike, uid: number, gid: number): void;
    /**
     * Asynchronously writes data to the path specified with some FileOptions.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be written.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined } | undefined
     */
    private writeFileAsync;
    /**
     * Writes data to the path specified with some FileOptions.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be written.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined } | undefined
     */
    writeFile(path: fs.PathLike | number, data: string | Buffer, options: fs.WriteFileOptions, callback?: fs.NoParamCallback): void;
    /**
     * Synchronously writes data to the path specified with some FileOptions.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. Defines the data to be .
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     */
    writeFileSync(path: fs.PathLike | number, data: string | Buffer, options?: fs.WriteFileOptions): void;
    /**
     * Asynchronously opens a file or directory and returns the file descriptor.
     * @param path Path to the file or directory.
     * @param flags Flags for read/write operations. Defaults to 'r'.
     * @param mode number. Read and write permissions. Defaults to 0o666.
     */
    private openAsync;
    /**
     * Opens a file or directory and returns the file descriptor.
     * @param path Path to the file or directory.
     * @param flags Flags for read/write operations. Defaults to 'r'.
     * @param mode number. Read and write permissions. Defaults to 0o666.
     */
    open(path: fs.PathLike, flags?: number | string, mode?: number | string, callback?: (err: Error | null, fd: number | null) => void): void;
    /**
     * Synchronously opens a file or directory and returns the file descriptor.
     * @param path Path to the file or directory.
     * @param flags Flags for read/write operations. Defaults to 'r'.
     * @param mode number. Read and write permissions. Defaults to 0o666.
     */
    openSync(path: fs.PathLike, flags?: number | string, mode?: number | string): number;
    lchown(path: fs.PathLike, uid: number, gid: number, callback: fs.NoParamCallback): void;
    lchownSync(path: fs.PathLike, uid: number, gid: number): void;
    lchmod(path: fs.PathLike, mode: string | number, callback: fs.NoParamCallback): void;
    lchmodSync(path: fs.PathLike, mode: string | number): void;
    watchFile(filename: fs.PathLike, options: any, listener: any): void;
    unwatchFile(filename: fs.PathLike, listener?: any): void;
    watch(filename: fs.PathLike, options: any, listener: any): void;
    copyFile(src: fs.PathLike, dest: fs.PathLike, callback: fs.NoParamCallback): void;
    copyFileSync(src: fs.PathLike, dest: fs.PathLike): void;
    writev(fd: number, buffers: NodeJS.ArrayBufferView[], cb: (err: NodeJS.ErrnoException | null, bytesWritten: number, buffers: NodeJS.ArrayBufferView[]) => void): void;
    writevSync(fd: number, buffers: NodeJS.ArrayBufferView[], position?: number | undefined): void;
    readv(fd: number, buffers: NodeJS.ArrayBufferView[], cb: (err: NodeJS.ErrnoException | null, bytesRead: number, buffers: NodeJS.ArrayBufferView[]) => void): void;
    readvSync(fd: number, buffers: NodeJS.ArrayBufferView[], position?: number | undefined): void;
    opendirSync(path: string, options?: fs.OpenDirOptions | undefined): void;
    opendir(path: string, cb: (err: NodeJS.ErrnoException | null, dir: fs.Dir) => void): void;
    Stats: any;
    Dirent: any;
    Dir: any;
    ReadStream: any;
    WriteStream: any;
    BigIntStats: any;
    /**
     * Get key used for encryption.
     */
    getKey(): Buffer | string;
    private getFileOptions;
    private getStreamOptions;
    private isCharacterEncoding;
    /**
     * Asynchronously reads the whole block that the position lies within.
     * @param fd File descriptor.
     * @param position Position of data required.
     */
    private readBlock;
    /**
     * Synchronously reads the whole block that the position lies within.
     * @param fd File descriptor.
     * @param position Position of data required.
     */
    private readBlockSync;
    /**
     * Asynchronously reads from disk the chunk containing the block that needs to be merged with new block
     * @param fd File descriptor.
     * @param newData Buffer containing the new data.
     * @param position Position of the insertion.
     */
    private overlaySegment;
    /**
     * Synchronously Reads from disk the chunk containing the block that needs to be merged with new block
     * @param fd File descriptor.
     * @param newData Buffer containing the new data.
     * @param position Position of the insertion.
     */
    private overlaySegmentSync;
    /**
     * Gets the byte offset from the beginning of the block that position lies within
     * @param position: number. Position.
     */
    private getBoundaryOffset;
    /**
     * Checks if path is a file descriptor (number) or not (string).
     * @param path Path of file.
     */
    private isFileDescriptor;
    /**
     * Retrieves the upperFd from an efs fd index.
     * @param fdIndex File descriptor.
     */
    private getUpperFd;
    /**
     * Retrieves the lowerFd from an efs fd index.
     * @param fdIndex File descriptor.
     */
    private getLowerFd;
    /**
     * Takes a position in a file and returns the block number that 'position' lies in.
     * @param position
     */
    private offsetToBlockNum;
    /**
     * Calculates the offset/position of the block number in the unencrypted file.
     * @param blockNum Block number.
     */
    private blockNumToOffset;
    /**
     * Calculates the offset/position of the chunk number in the unencrypted file.
     * @param chunkNum Chunk number.
     */
    private chunkNumToOffset;
    /**
     * Creates a block generator for block iteration, split is per block length.
     * @param blocks Buffer containing blocks to be split.
     * @param blockSize Size of an individual block.
     */
    private blockGenerator;
    /**
     * Creates a chunk generator for chunk iteration, split is per block length.
     * @param chunks Buffer containing blocks to be split.
     * @param chunkSize Size of an individual block.
     */
    private chunkGenerator;
    /**
     * Synchronously checks if file (fd) contains conntent or not.
     * @param fd File descriptor.
     */
    private hasContentSync;
    /**
     * Synchronously checks for file size.
     * @param fd File descriptor.
     */
    private getPostWriteFileSize;
    private writeMetadataSync;
    private loadMetadata;
    private loadMetadataSync;
    private getMetadata;
    private getMetaField;
    private getMetadataOffsetSync;
    private getEfsFd;
    /**
     * Processes path types and collapses it to a string.
     * The path types can be string or Buffer or URL.
     * @private
     */
    private getPath;
    /**
     * Acquires the file path from an URL object.
     * @private
     */
    private getPathFromURL;
}
export default EncryptedFS;
