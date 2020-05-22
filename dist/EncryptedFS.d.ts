/// <reference types="node" />
import fs from 'fs';
import { CryptoInterface } from './EncryptedFSCrypto';
import { optionsStream, ReadStream, WriteStream } from './Streams';
import { EncryptedFSCryptoWorker } from './EncryptedFSCryptoWorker';
import { ModuleThread, Pool } from 'threads';
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
     * @param fd number. File descriptor.
     * @returns Promise<void>.
     */
    access(path: fs.PathLike, mode?: number): Promise<void>;
    /**
     * Synchronously tests a user's permissions for the file specified by path.
     * @param fd number. File descriptor.
     * @returns void.
     */
    accessSync(path: fs.PathLike, mode?: number): void;
    /**
     * Asynchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
     * @param path string. Path to create.
     * @returns void.
     */
    lstat(path: fs.PathLike): Promise<fs.Stats>;
    /**
     * Synchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
     * @param path string. Path to create.
     * @returns void.
     */
    lstatSync(path: fs.PathLike): fs.Stats;
    /**
     * Asynchronously makes the directory in the upper file system directory. Propagates upper fs method.
     * @param path string. Path to create.
     * @param mode number | undefined. Permissions or mode.
     * @returns void.
     */
    mkdir(path: fs.PathLike, options?: fs.MakeDirectoryOptions): Promise<string>;
    /**
     * Synchronously makes the directory in the upper file system directory. Propagates upper fs method.
     * @param path string. Path to create.
     * @param mode number | undefined. Permissions or mode.
     * @returns void.
     */
    mkdirSync(path: fs.PathLike, options?: fs.MakeDirectoryOptions): void;
    /**
     * Synchronously makes a temporary directory with the prefix given.
     * @param prefix string. Prefix of temporary directory.
     * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
     * @returns void.
     */
    mkdtemp(prefix: string, options?: {
        encoding: BufferEncoding;
    } | BufferEncoding | null | undefined): Promise<string>;
    /**
     * Synchronously makes a temporary directory with the prefix given.
     * @param prefix string. Prefix of temporary directory.
     * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
     * @returns void.
     */
    mkdtempSync(prefix: string, options?: {
        encoding: BufferEncoding;
    } | BufferEncoding | null | undefined): string;
    /**
     * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
     * @param path string. Path to create.
     * @returns void.
     */
    stat(path: fs.PathLike): Promise<fs.Stats>;
    /**
     * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
     * @param path string. Path to create.
     * @returns void.
     */
    statSync(path: fs.PathLike): fs.Stats;
    /**
     * Asynchronously removes the directory in the upper file system directory. Propagates upper fs method.
     * @param path string. Path to create.
     * @param options: { recursive: boolean }.
     * @returns void.
     */
    rmdir(path: fs.PathLike, options?: fs.RmDirAsyncOptions | undefined): Promise<void>;
    /**
     * Synchronously removes the directory in the upper file system directory. Propagates upper fs method.
     * @param path string. Path to create.
     * @param options: { recursive: boolean }.
     * @returns void.
     */
    rmdirSync(path: fs.PathLike, options?: fs.RmDirOptions | undefined): void;
    /**
     * Asynchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
     * @param target string. Destination path.
     * @param path string. Source path.
     * @returns void.
     */
    symlink(target: fs.PathLike, path: fs.PathLike, type: 'dir' | 'file' | 'junction' | null | undefined): Promise<void>;
    /**
     * Synchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
     * @param dstPath string. Destination path.
     * @param srcPath string. Source path.
     * @returns void.
     */
    symlinkSync(target: fs.PathLike, path: fs.PathLike, type?: 'dir' | 'file' | 'junction' | null | undefined): void;
    /**
     * Asynchronously changes the size of the file by len bytes.
     * @param dstPath string. Destination path.
     * @param srcPath string. Source path.
     * @returns void.
     */
    truncate(file: fs.PathLike | number, len?: number): Promise<void>;
    /**
     * Synchronously changes the size of the file by len bytes.
     * @param dstPath string. Destination path.
     * @param srcPath string. Source path.
     * @returns void.
     */
    truncateSync(file: fs.PathLike | number, len?: number): void;
    /**
     * Asynchronously unlinks the given path in the upper and lower file system directories.
     * @param path string. Path to create.
     * @returns void.
     */
    unlink(path: fs.PathLike): Promise<void>;
    /**
     * Synchronously unlinks the given path in the upper and lower file system directories.
     * @param path string. Path to create.
     * @returns void.
     */
    unlinkSync(path: fs.PathLike): void;
    /**
     * Asynchronously changes the access and modification times of the file referenced by path.
     * @param path string. Path to file.
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     * @returns void.
     */
    utimes(path: fs.PathLike, atime: number | string | Date, mtime: number | string | Date): Promise<void>;
    /**
     * Synchronously changes the access and modification times of the file referenced by path.
     * @param path string. Path to file.
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     * @returns void.
     */
    utimesSync(path: fs.PathLike, atime: number | string | Date, mtime: number | string | Date): void;
    /**
     * Asynchronously closes the file descriptor.
     * @param fd number. File descriptor.
     * @returns Promise<void>.
     */
    close(fd: number): Promise<void>;
    /**
     * Synchronously closes the file descriptor.
     * @param fd number. File descriptor.
     * @returns void.
     */
    closeSync(fd: number): void;
    /**
     * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param path string. Path to directory to be read.
     * @param options FileOptions.
     * @returns string[] (directory contents).
     */
    readdir(path: fs.PathLike, options?: {
        encoding: BufferEncoding;
        withFileTypes?: false;
    } | undefined): Promise<string[]>;
    /**
     * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param path string. Path to directory to be read.
     * @param options FileOptions.
     * @returns string[] (directory contents).
     */
    readdirSync(path: fs.PathLike, options?: {
        encoding: BufferEncoding;
        withFileTypes?: false;
    } | undefined): string[];
    /**
     * Creates a read stream from the given path and options.
     * @param path string.
     * @returns boolean.
     */
    createReadStream(path: fs.PathLike, options: optionsStream | undefined): ReadStream;
    /**
     * Creates a write stream from the given path and options.
     * @param path string.
     * @returns boolean.
     */
    createWriteStream(path: fs.PathLike, options: optionsStream | undefined): WriteStream;
    /**
     * Synchronously checks if path exists.
     * @param path string.
     * @returns boolean.
     */
    exists(path: fs.PathLike): Promise<boolean>;
    /**
     * Synchronously checks if path exists.
     * @param path string.
     * @returns boolean.
     */
    existsSync(path: fs.PathLike): boolean;
    /**
     * Asynchronously manipulates the allocated disk space for a file.
     * @param fdIndex number. File descriptor index.
     * @param offset number. Offset to start manipulations from.
     * @param len number. New length for the file.
     * @returns void.
     */
    fallocate(fdIndex: number, offset: number, len: number): Promise<void>;
    /**
     * Synchronously manipulates the allocated disk space for a file.
     * @param fdIndex number. File descriptor index.
     * @param offset number. Offset to start manipulations from.
     * @param len number. New length for the file.
     * @returns void.
     */
    fallocateSync(fdIndex: number, offset: number, len: number): void;
    /**
     * Asynchronously changes the permissions of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param mode number. New permissions set.
     * @returns void.
     */
    fchmod(fdIndex: number, mode?: number): Promise<void>;
    /**
     * Synchronously changes the permissions of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param mode number. New permissions set.
     * @returns void.
     */
    fchmodSync(fdIndex: number, mode?: number): void;
    /**
     * Asynchronously changes the owner or group of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     * @returns void.
     */
    fchown(fdIndex: number, uid: number, gid: number): Promise<void>;
    /**
     * Synchronously changes the owner or group of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     * @returns void.
     */
    fchownSync(fdIndex: number, uid: number, gid: number): void;
    /**
     * Asynchronously flushes in memory data to disk. Not required to update metadata.
     * @param fdIndex number. File descriptor index.
     * @returns void.
     */
    fdatasync(fdIndex: number): Promise<void>;
    /**
     * Synchronously flushes in memory data to disk. Not required to update metadata.
     * @param fdIndex number. File descriptor index.
     * @returns void.
     */
    fdatasyncSync(fdIndex: number): void;
    /**
     * Asynchronously retrieves data about the file described by fdIndex.
     * @param fd number. File descriptor.
     * @returns void.
     */
    fstat(fd: number): Promise<fs.Stats>;
    /**
     * Synchronously retrieves data about the file described by fdIndex.
     * @param fd number. File descriptor.
     * @returns void.
     */
    fstatSync(fd: number): fs.Stats;
    /**
     * Synchronously flushes all modified data to disk.
     * @param fdIndex number. File descriptor index.
     * @returns void.
     */
    fsync(fdIndex: number): Promise<void>;
    /**
     * Synchronously flushes all modified data to disk.
     * @param fdIndex number. File descriptor index.
     * @returns void.
     */
    fsyncSync(fdIndex: number): void;
    /**
     * Asynchronously truncates to given length.
     * @param fdIndex number. File descriptor index
     * @param len number. Length to truncate to.
     * @returns void.
     */
    ftruncate(fdIndex: number, len?: number): Promise<void>;
    /**
     * Synchronously truncates to given length.
     * @param fdIndex number. File descriptor index
     * @param len number. Length to truncate to.
     * @returns void.
     */
    ftruncateSync(fdIndex: number, len?: number): void;
    /**
     * Asynchronously changes the access and modification times of the file referenced by fdIndex.
     * @param fdIndex number. File descriptor index
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     * @returns void.
     */
    futimes(fdIndex: number, atime: number | string | Date, mtime: number | string | Date): Promise<void>;
    /**
     * Synchronously changes the access and modification times of the file referenced by fdIndex.
     * @param fdIndex number. File descriptor index
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     * @returns void.
     */
    futimesSync(fdIndex: number, atime: number | string | Date, mtime: number | string | Date): void;
    /**
     * Synchronously links a path to a new path.
     * @param existingPath string.
     * @param newPath string.
     * @returns void.
     */
    link(existingPath: fs.PathLike, newPath: fs.PathLike): Promise<void>;
    /**
     * Synchronously links a path to a new path.
     * @param existingPath string.
     * @param newPath string.
     * @returns void.
     */
    linkSync(existingPath: fs.PathLike, newPath: fs.PathLike): void;
    /**
     * Synchronously reads data from a file given the path of that file.
     * @param path string. Path to file.
     * @returns void.
     */
    readFile(path: fs.PathLike | number, options?: fs.WriteFileOptions): Promise<string | Buffer>;
    /**
     * Synchronously reads data from a file given the path of that file.
     * @param path string. Path to file.
     * @returns Buffer (read buffer).
     */
    readFileSync(path: fs.PathLike | number, options?: fs.WriteFileOptions): string | Buffer;
    /**
     * Synchronously reads link of the given the path. Propagated from upper fs.
     * @param path string. Path to file.
     * @param options FileOptions | undefined.
     * @returns Buffer | string.
     */
    readlink(path: fs.PathLike, options?: fs.WriteFileOptions | undefined): Promise<Buffer | string>;
    /**
     * Synchronously reads link of the given the path. Propagated from upper fs.
     * @param path string. Path to file.
     * @param options FileOptions | undefined.
     * @returns string | Buffer.
     */
    readlinkSync(path: fs.PathLike, options?: fs.WriteFileOptions | undefined): string | Buffer;
    /**
     * Asynchronously determines the actual location of path. Propagated from upper fs.
     * @param path string. Path to file.
     * @param options FileOptions | undefined.
     * @returns void.
     */
    realpath(path: fs.PathLike, options?: fs.WriteFileOptions | undefined): Promise<string>;
    /**
     * Synchronously determines the actual location of path. Propagated from upper fs.
     * @param path string. Path to file.
     * @param options FileOptions | undefined.
     * @returns Buffer (read buffer).
     */
    realpathSync(path: fs.PathLike, options?: fs.WriteFileOptions | undefined): string | Buffer;
    /**
     * Asynchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
     * @param oldPath string. Old path.
     * @param oldPath string. New path.
     * @returns void.
     */
    rename(oldPath: fs.PathLike, newPath: fs.PathLike): Promise<void>;
    /**
     * Synchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
     * @param oldPath string. Old path.
     * @param oldPath string. New path.
     * @returns void.
     */
    renameSync(oldPath: fs.PathLike, newPath: fs.PathLike): void;
    /**
     * Asynchronously reads data at an offset, position and length from a file descriptor into a given buffer.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The offset in the buffer at which to start writing.
     * @param length number. The number of bytes to read.
     * @param position number. The offset from the beginning of the file from which data should be read.
     * @returns Promise<number> (bytes read).
     */
    read(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number): Promise<number>;
    /**
     * Synchronously reads data at an offset, position and length from a file descriptor into a given buffer.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be read into.
     * @param offset number. The offset in the buffer at which to start writing.
     * @param length number. The number of bytes to read.
     * @param position number. The offset from the beginning of the file from which data should be read.
     * @returns number (bytes read).
     */
    readSync(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number): number;
    /**
     * Asynchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
     * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
     * @param position number. The offset from the beginning of the file where this data should be written.
     * @returns Promise<number>.
     */
    write(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number): Promise<number>;
    /**
     * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
     * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
     * @param position number. The offset from the beginning of the file where this data should be written.
     * @returns number (length).
     */
    writeSync(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number): number;
    /**
     * Asynchronously append data to a file, creating the file if it does not exist.
     * @param file string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be appended.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     * @returns Promise<void>.
     */
    appendFile(file: fs.PathLike | number, data: Buffer, options?: fs.WriteFileOptions): Promise<void>;
    /**
     * Synchronously append data to a file, creating the file if it does not exist.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be appended.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     * @returns Promise<void>.
     */
    appendFileSync(file: fs.PathLike | number, data: Buffer, options?: fs.WriteFileOptions): void;
    /**
     * Asynchronously changes the access permissions of the file system object described by path.
     * @param path string. Path to the fs object.
     * @param mode number. New permissions set.
     * @returns void.
     */
    chmod(path: fs.PathLike, mode?: number): Promise<void>;
    /**
     * Synchronously changes the access permissions of the file system object described by path.
     * @param path string. Path to the fs object.
     * @param mode number. New permissions set.
     * @returns void.
     */
    chmodSync(path: fs.PathLike, mode?: number): void;
    /**
     * Synchronously changes the owner or group of the file system object described by path.
     * @param path string. Path to the fs object.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     * @returns void.
     */
    chown(path: fs.PathLike, uid: number, gid: number): Promise<void>;
    /**
     * Synchronously changes the owner or group of the file system object described by path.
     * @param path string. Path to the fs object.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     * @returns void.
     */
    chownSync(path: fs.PathLike, uid: number, gid: number): void;
    /**
     * Asynchronously writes data to the path specified with some FileOptions.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be written.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined } | undefined
     * @returns void.
     */
    writeFile(path: fs.PathLike | number, data: string | Buffer, options?: fs.WriteFileOptions): Promise<void>;
    /**
     * Synchronously writes data to the path specified with some FileOptions.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. Defines the data to be .
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     * @returns void.
     */
    writeFileSync(path: fs.PathLike | number, data: string | Buffer, options?: fs.WriteFileOptions): void;
    /**
     * Asynchronously opens a file or directory and returns the file descriptor.
     * @param path string. Path to the file or directory.
     * @param flags string. Flags for read/write operations. Defaults to 'r'.
     * @param mode number. Read and write permissions. Defaults to 0o666.
     * @returns Promise<number>
     */
    open(path: fs.PathLike, flags?: number | string, mode?: number | string): Promise<number>;
    /**
     * Synchronously opens a file or directory and returns the file descriptor.
     * @param path string. Path to the file or directory.
     * @param flags string. Flags for read/write operations. Defaults to 'r'.
     * @param mode number. Read and write permissions. Defaults to 0o666.
     * @returns number (file descriptor in the upperDir).
     */
    openSync(path: fs.PathLike, flags?: number | string, mode?: number | string): number;
    /**
     * Get key used for encryption.
     * @returns Buffer | string (Key)
     */
    getKey(): Buffer | string;
    private getFileOptions;
    private getStreamOptions;
    private isCharacterEncoding;
    /**
     * Asynchronously reads the whole block that the position lies within.
     * @param fd File descriptor.
     * @param position Position of data required.
     * @returns Buffer.
     */
    private readBlock;
    /**
     * Synchronously reads the whole block that the position lies within.
     * @param fd File descriptor.
     * @param position Position of data required.
     * @returns Buffer.
     */
    private readBlockSync;
    /**
     * Asynchronously reads from disk the chunk containing the block that needs to be merged with new block
     * @param fd File descriptor.
     * @param newData Buffer containing the new data.
     * @param position Position of the insertion.
     * @returns Buffer (a plaintext buffer containing the merge blocks in a single block).
     */
    private overlaySegment;
    /**
     * Synchronously Reads from disk the chunk containing the block that needs to be merged with new block
     * @param fd File descriptor.
     * @param newData Buffer containing the new data.
     * @param position Position of the insertion.
     * @returns Buffer (a plaintext buffer containing the merge blocks in a single block).
     */
    private overlaySegmentSync;
    /**
     * Gets the byte offset from the beginning of the block that position lies within
     * @param position: number. Position.
     * @returns number. Boundary offset
     */
    private getBoundaryOffset;
    /**
     * Checks if path is a file descriptor (number) or not (string).
     * @param path Path of file.
     * @returns boolean
     */
    private isFileDescriptor;
    /**
     * Retrieves the upperFd from an efs fd index.
     * @param fdIndex File descriptor.
     * @returns number
     */
    private getUpperFd;
    /**
     * Retrieves the lowerFd from an efs fd index.
     * @param fdIndex File descriptor.
     * @returns number
     */
    private getLowerFd;
    /**
     * Takes a position in a file and returns the block number that 'position' lies in.
     * @param position
     * @returns number (Block number)
     */
    private offsetToBlockNum;
    /**
     * Calculates the offset/position of the block number in the unencrypted file.
     * @param blockNum Block number.
     * @returns number (position offset)
     */
    private blockNumToOffset;
    /**
     * Calculates the offset/position of the chunk number in the unencrypted file.
     * @param chunkNum Chunk number.
     * @returns number (position offset)
     */
    private chunkNumToOffset;
    /**
     * Creates a block generator for block iteration, split is per block length.
     * @param blocks Buffer containing blocks to be split.
     * @param blockSize Size of an individual block.
     * @returns IterableIterator<Buffer> (the iterator for the blocks split into buffer.length/blockSize blocks)
     */
    private blockGenerator;
    /**
     * Creates a chunk generator for chunk iteration, split is per block length.
     * @param chunks Buffer containing blocks to be split.
     * @param chunkSize Size of an individual block.
     * @returns IterableIterator<Buffer> (the iterator for the chunks split into buffer.length/chunkSize blocks)
     */
    private chunkGenerator;
    /**
     * Synchronously checks if file (fd) contains conntent or not.
     * @param fd File descriptor.
     * @returns boolean (true if file has content, false if file has no content)
     */
    private hasContentSync;
    /**
     * Synchronously checks for file size.
     * @param fd File descriptor.
     * @returns boolean (true if file has content, false if file has no content)
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
