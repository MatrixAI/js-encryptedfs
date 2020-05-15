import fs from 'fs'
import Crypto from './Crypto'
import FileDescriptor from './FileDescriptor'
import Path from 'path'
import { constants, DEFAULT_FILE_PERM } from './constants'
import { EncryptedFSError, errno } from './EncryptedFSError'
import { optionsStream, ReadStream, WriteStream } from './Streams'
import { promisify } from 'util'
import autoBind from 'auto-bind-proxy'
import { CryptoInterface, cryptoConstants } from './util'

/* TODO: we need to maintain seperate permission for the lower directory vs the upper director
 * For example: if you open a file as write-only, how will you merge the block on the ct file?
 * First you need to read, overlay, then write. But we can read, since the file is write-only.
 * So the lower dir file always needs to be read-write, the upper dir file permission will be
 * whatever the user specified.
 *
 * One way to implement this is through inheriting the FileDeescriptors class.
 * Extend the class by adding another attribute for the
 */

type UpperDirectoryMetadata = {
  size: number,
  keyHash: Buffer
}

/**
 * Encrypted filesystem written in TypeScript for Node.js.
 * @param key A key.
 * @param upperDir The upper directory file system.
 * @param lowerDir The lower directory file system.
 * @param initVectorSize The size of the initial vector, defaults to 16.
 * @param blockSize The size of block, defaults to 4096.
 * @param useWebWorkers Use webworkers to make crypto tasks true async, defaults to false.
 */
export default class EncryptedFS {
  private uid: number
  private gid: number
  private umask: number
  private upperDir: any
  private upperDirContextControl: any
  private lowerDir: typeof fs
  private lowerDirContextControl: typeof process
  private crypto: Crypto
  private chunkSize: number
  private blockSize: number
  private fileDescriptors: Map<number, FileDescriptor>
  private masterKey: Buffer
  private metadata: { [fd: number]: UpperDirectoryMetadata }
  constants: any
  constructor(
    key: Buffer | string,
    upperDir: typeof fs,
    upperDirContextControl: typeof fs,
    lowerDir: typeof fs,
    lowerDirContextControl: typeof process,
    umask: number = 0o022,
    blockSize: number = 4096,
    useWebWorkers: boolean = false,
    cryptoLib: CryptoInterface | undefined = undefined,
  ) {
    this.umask = umask
    // Set key
    if (typeof key === 'string') {
      this.masterKey = Buffer.from(key)
    } else {
      this.masterKey = key
    }
    if (cryptoLib) {
      this.crypto = new Crypto(this.masterKey, cryptoLib, useWebWorkers)
    } else {
      this.crypto = new Crypto(this.masterKey, require('crypto'), useWebWorkers)
    }
    this.upperDir = autoBind(upperDir)
    this.upperDirContextControl = autoBind(upperDirContextControl)
    this.lowerDir = lowerDir
    this.lowerDirContextControl = lowerDirContextControl
    this.blockSize = blockSize
    this.chunkSize = this.blockSize + cryptoConstants.SALT_LEN + cryptoConstants.INIT_VECTOR_LEN + cryptoConstants.AUTH_TAG_LEN
    this.fileDescriptors = new Map()
    this.metadata = {}
    this.constants = constants
  }

  getUmask(): number {
    return this.umask
  }

  setUmask(umask: number): void {
    this.upperDirContextControl.setUmask(umask)
    this.lowerDirContextControl.umask(umask)
    this.umask = umask
  }

  getUid(): number {
    return this.uid
  }

  setUid(uid: number): void {
    this.upperDirContextControl.setUid(uid)
    this.lowerDirContextControl.setuid(uid)
    this.uid = uid
  }

  getGid(): number {
    return this.gid
  }

  setGid(gid: number): void {
    this.upperDirContextControl.setGid(gid)
    this.lowerDirContextControl.setgid(gid)
    this.gid = gid
  }

  getCwd(): string {
    return this.upperDirContextControl.getCwd()
  }

  // TODO: nodejs fs (i.e. lowerDir) does not have a native method for changing directory and depends on process.chdir(...)
  // which seems a little too much like a global change. We could also just keep track of the cwd in upperDir (vfs) and then
  // every time there is an operation using lowerDir, we just prepend this cwd to the path.
  chdir(path: string): void {
    this.upperDirContextControl.chdir(path)
    this.lowerDirContextControl.chdir(path)
  }

	/**
	 * Asynchronously tests a user's permissions for the file specified by path.
	 * @param fd number. File descriptor.
	 * @returns Promise<void>.
	 */
  async access(
    path: fs.PathLike,
    mode: number = 0
  ): Promise<void> {
    try {
      await promisify(this.lowerDir.access)(path, mode)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously tests a user's permissions for the file specified by path.
	 * @param fd number. File descriptor.
	 * @returns void.
	 */
  accessSync(
    path: fs.PathLike,
    mode: number = this.constants.F_OK
  ): void {
    this.lowerDir.accessSync(path, mode)
  }

	/**
	 * Asynchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
	 * @param path string. Path to create.
	 * @returns void.
	 */
  async lstat(
    path: fs.PathLike
  ): Promise<fs.Stats> {
    try {
      return await promisify(this.upperDir.lstatSync)(path)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
	 * @param path string. Path to create.
	 * @returns void.
	 */
  lstatSync(
    path: fs.PathLike
  ): fs.Stats {
    return this.upperDir.lstatSync(path)
  }

	/**
	 * Asynchronously makes the directory in the upper file system directory. Propagates upper fs method.
	 * @param path string. Path to create.
	 * @param mode number | undefined. Permissions or mode.
	 * @returns void.
	 */
  async mkdir(
    path: fs.PathLike,
    options: fs.MakeDirectoryOptions = { mode: 0o777, recursive: false }
  ): Promise<string> {
    try {
      if (options.recursive) {
        await promisify(this.upperDir.mkdirp)(path, options.mode)
      } else {
        await promisify(this.upperDir.mkdir) (path, options.mode)
      }
      const _path = await promisify(this.lowerDir.mkdir)(path, options)
      return _path!
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously makes the directory in the upper file system directory. Propagates upper fs method.
	 * @param path string. Path to create.
	 * @param mode number | undefined. Permissions or mode.
	 * @returns void.
	 */
  mkdirSync(
    path: fs.PathLike,
    options: fs.MakeDirectoryOptions = { mode: 0o777, recursive: false }
  ): void {
    this.lowerDir.mkdirSync(path, options)
    if (options.recursive) {
      this.upperDir.mkdirpSync(path, options.mode)
    } else {
      this.upperDir.mkdirSync(path, options.mode)
    }
  }

	/**
	 * Synchronously makes a temporary directory with the prefix given.
	 * @param prefix string. Prefix of temporary directory.
	 * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
	 * @returns void.
	 */
  async mkdtemp(
    prefix: string,
    options: { encoding: BufferEncoding } | BufferEncoding | null | undefined = 'utf8'
  ): Promise<string> {
    try {
      const _path = await promisify(this.upperDir.mkdtemp)(prefix, options)
      await promisify(this.lowerDir.mkdtemp)(prefix, options)
      return _path
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously makes a temporary directory with the prefix given.
	 * @param prefix string. Prefix of temporary directory.
	 * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
	 * @returns void.
	 */
  mkdtempSync(
    prefix: string,
    options: { encoding: BufferEncoding } | BufferEncoding | null | undefined = 'utf8'
  ): string {
    const lowerPath = this.lowerDir.mkdtempSync(prefix, options)
    const lowerStat = this.lowerDir.statSync(lowerPath)
    this.upperDir.mkdirpSync(lowerPath, lowerStat.mode)
    return <string>lowerPath
  }

	/**
	 * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
	 * @param path string. Path to create.
	 * @returns void.
	 */
  async stat(
    path: fs.PathLike
  ): Promise<fs.Stats> {
    try {
      return await promisify(this.upperDir.stat)(path)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
	 * @param path string. Path to create.
	 * @returns void.
	 */
  statSync(
    path: fs.PathLike
  ): fs.Stats {
    return this.upperDir.statSync(path)
  }

	/**
	 * Asynchronously removes the directory in the upper file system directory. Propagates upper fs method.
	 * @param path string. Path to create.
	 * @param options: { recursive: boolean }.
	 * @returns void.
	 */
  async rmdir(
    path: fs.PathLike,
    options: fs.RmDirAsyncOptions | undefined = undefined
  ): Promise<void> {
    try {
      if (!(options?.recursive ?? false)) {
        await promisify(this.upperDir.mkdtemp)(path, options)
      }
      await promisify(this.lowerDir.rmdir)(path, options)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously removes the directory in the upper file system directory. Propagates upper fs method.
	 * @param path string. Path to create.
	 * @param options: { recursive: boolean }.
	 * @returns void.
	 */
  rmdirSync(
    path: fs.PathLike,
    options: fs.RmDirOptions | undefined = undefined
  ): void {
    // TODO: rmdirSync on VFS doesn't have an option to recusively delete
    try {
      if (!options?.recursive) {
        this.upperDir.rmdirSync(path)
      }
      this.lowerDir.rmdirSync(path, options)
    } catch (err) {
      throw (err)
    }
  }

	/**
	 * Asynchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
	 * @param target string. Destination path.
	 * @param path string. Source path.
	 * @returns void.
	 */
  async symlink(
    target: fs.PathLike,
    path: fs.PathLike,
    type: "dir" | "file" | "junction" | null | undefined
  ): Promise<void> {
    try {
      this.upperDir.symlinkSync(target, path, type)
      await promisify(this.lowerDir.symlink)(target, path, type)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
	 * @param dstPath string. Destination path.
	 * @param srcPath string. Source path.
	 * @returns void.
	 */
  symlinkSync(
    target: fs.PathLike,
    path: fs.PathLike,
    type: "dir" | "file" | "junction" | null | undefined = 'file'
  ): void {
    this.upperDir.symlinkSync(target, path, type)
    this.lowerDir.symlinkSync(target, path, type)
  }

	/**
	 * Asynchronously changes the size of the file by len bytes.
	 * @param dstPath string. Destination path.
	 * @param srcPath string. Source path.
	 * @returns void.
	 */
  async truncate(
    file: fs.PathLike | number,
    len: number = 0
  ): Promise<void> {
    try {
      this.upperDir.truncateSync(file, len)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously changes the size of the file by len bytes.
	 * @param dstPath string. Destination path.
	 * @param srcPath string. Source path.
	 * @returns void.
	 */
  truncateSync(
    file: fs.PathLike | number,
    len: number = 0
  ): void {
    return this.upperDir.truncateSync(file, len)
  }

	/**
	 * Asynchronously unlinks the given path in the upper and lower file system directories.
	 * @param path string. Path to create.
	 * @returns void.
	 */
  async unlink(
    path: fs.PathLike
  ): Promise<void> {
    try {
      this.upperDir.unlinkSync(path)
      await promisify(this.lowerDir.unlink)(path)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously unlinks the given path in the upper and lower file system directories.
	 * @param path string. Path to create.
	 * @returns void.
	 */
  unlinkSync(
    path: fs.PathLike
  ): void {
    return this.upperDir.unlinkSync(path)
  }

	/**
	 * Asynchronously changes the access and modification times of the file referenced by path.
	 * @param path string. Path to file.
	 * @param atime number | string | Date. Access time.
	 * @param mtime number | string | Date. Modification time.
	 * @returns void.
	 */
  async utimes(
    path: fs.PathLike,
    atime: number | string | Date,
    mtime: number | string | Date
  ): Promise<void> {
    try {
      this.upperDir.utimesSync(path, atime, mtime)
      await promisify(this.lowerDir.utimes)(path, atime, mtime)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously changes the access and modification times of the file referenced by path.
	 * @param path string. Path to file.
	 * @param atime number | string | Date. Access time.
	 * @param mtime number | string | Date. Modification time.
	 * @returns void.
	 */
  utimesSync(
    path: fs.PathLike,
    atime: number | string | Date,
    mtime: number | string | Date
  ): void {
    this.upperDir.utimesSync(path, atime, mtime)
    this.lowerDir.utimesSync(path, atime, mtime)
  }

	/**
	 * Asynchronously closes the file descriptor.
	 * @param fd number. File descriptor.
	 * @returns Promise<void>.
	 */
  async close(
    fd: number
  ): Promise<void> {
    if (this.isFileDescriptor(fd)) {
      this.upperDir.closeSync(fd)
      const lowerFd = this.getLowerFd(fd)
      await promisify(this.lowerDir.close)(lowerFd)
    } else {
      throw(new EncryptedFSError(errno.EBADF, null, null, 'close'))
    }
  }

	/**
	 * Synchronously closes the file descriptor.
	 * @param fd number. File descriptor.
	 * @returns void.
	 */
  closeSync(fd: number): void {
    const isUserFileDescriptor = this.isFileDescriptor(fd)
    if (isUserFileDescriptor) {
      const lowerFd = this.getLowerFd(fd)
      this.lowerDir.closeSync(lowerFd)
      this.upperDir.closeSync(fd)
      this.fileDescriptors.delete(fd)
    }
  }

	/**
	 * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
	 * @param path string. Path to directory to be read.
	 * @param options FileOptions.
	 * @returns string[] (directory contents).
	 */
  async readdir(
    path: fs.PathLike,
    options: { encoding: BufferEncoding, withFileTypes?: false } | undefined = undefined
  ): Promise<string[]> {
    try {
      return await promisify(this.lowerDir.readdir)(path, options)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
	 * @param path string. Path to directory to be read.
	 * @param options FileOptions.
	 * @returns string[] (directory contents).
	 */
  readdirSync(
    path: fs.PathLike,
    options: { encoding: BufferEncoding, withFileTypes?: false } | undefined = undefined
  ): string[] {
    const upperDirContents = this.upperDir.readdirSync(path, options)
    return upperDirContents
  }

	/**
	 * Creates a read stream from the given path and options.
	 * @param path string.
	 * @returns boolean.
	 */
  createReadStream(
    path: fs.PathLike,
    options: optionsStream | undefined
  ): ReadStream {
    path = this.getPath(path)
    options = this.getStreamOptions(
      {
        flags: 'r',
        encoding: undefined,
        fd: null,
        mode: DEFAULT_FILE_PERM,
        autoClose: true,
        end: Infinity
      },
      options
    )
    if (options.start !== undefined) {
      if (options.start > options.end!) {
        throw new RangeError('ERR_VALUE_OUT_OF_RANGE')
      }
    }
    return new ReadStream(path, options, this)
  }

	/**
	 * Creates a write stream from the given path and options.
	 * @param path string.
	 * @returns boolean.
	 */
  createWriteStream(
    path: fs.PathLike,
    options: optionsStream | undefined
  ): WriteStream {
    path = this.getPath(path)
    options = this.getStreamOptions(
      {
        flags: 'w',
        encoding: 'utf8',
        fd: null,
        mode: DEFAULT_FILE_PERM,
        autoClose: true
      },
      options
    )
    if (options.start !== undefined) {
      if (options.start < 0) {
        throw new RangeError('ERR_VALUE_OUT_OF_RANGE')
      }
    }
    return new WriteStream(path, options, this)
  }

	/**
	 * Synchronously checks if path exists.
	 * @param path string.
	 * @returns boolean.
	 */
  async exists(
    path: fs.PathLike
  ): Promise<boolean> {
    // TODO: make sure upper and lower directories agree
    try {
      const existsInUpper = this.upperDir.existsSync(path)
      const existsInLower = await promisify(this.lowerDir.exists)(path)
      return existsInLower && existsInUpper
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously checks if path exists.
	 * @param path string.
	 * @returns boolean.
	 */
  existsSync(
    path: fs.PathLike
  ): boolean {
    // TODO: make sure upper and lower directories agree
    return this.upperDir.existsSync(path) && this.lowerDir.existsSync(path)
  }

	/**
	 * Asynchronously manipulates the allocated disk space for a file.
	 * @param fdIndex number. File descriptor index.
	 * @param offset number. Offset to start manipulations from.
	 * @param len number. New length for the file.
	 * @returns void.
	 */
  async fallocate(
    fdIndex: number,
    offset: number,
    len: number
  ): Promise<void> {
    return await promisify(this.upperDir.fallocate)(fdIndex, offset, len)
  }

	/**
	 * Synchronously manipulates the allocated disk space for a file.
	 * @param fdIndex number. File descriptor index.
	 * @param offset number. Offset to start manipulations from.
	 * @param len number. New length for the file.
	 * @returns void.
	 */
  fallocateSync(
    fdIndex: number,
    offset: number,
    len: number
  ): void {
    return this.upperDir.fallocateSync(fdIndex, offset, len)
  }

	/**
	 * Asynchronously changes the permissions of the file referred to by fdIndex.
	 * @param fdIndex number. File descriptor index.
	 * @param mode number. New permissions set.
	 * @returns void.
	 */
  async fchmod(
    fdIndex: number,
    mode: number = 0,
  ): Promise<void> {
    return await promisify(this.upperDir.fchmod)(fdIndex, mode)
  }

	/**
	 * Synchronously changes the permissions of the file referred to by fdIndex.
	 * @param fdIndex number. File descriptor index.
	 * @param mode number. New permissions set.
	 * @returns void.
	 */
  fchmodSync(
    fdIndex: number,
    mode: number = 0
  ): void {
    return this.upperDir.fchmodSync(fdIndex, mode)
  }

	/**
	 * Asynchronously changes the owner or group of the file referred to by fdIndex.
	 * @param fdIndex number. File descriptor index.
	 * @param uid number. User identifier.
	 * @param gid number. Group identifier.
	 * @returns void.
	 */
  async fchown(
    fdIndex: number,
    uid: number,
    gid: number,
  ): Promise<void> {
    return await promisify(this.upperDir.fchown)(fdIndex, uid, gid)
  }

	/**
	 * Synchronously changes the owner or group of the file referred to by fdIndex.
	 * @param fdIndex number. File descriptor index.
	 * @param uid number. User identifier.
	 * @param gid number. Group identifier.
	 * @returns void.
	 */
  fchownSync(
    fdIndex: number,
    uid: number,
    gid: number
  ): void {
    return this.upperDir.fchownSync(fdIndex, uid, gid)
  }

	/**
	 * Asynchronously flushes in memory data to disk. Not required to update metadata.
	 * @param fdIndex number. File descriptor index.
	 * @returns void.
	 */
  async fdatasync(
    fdIndex: number
  ): Promise<void> {
    return await promisify(this.upperDir.fdatasync)(fdIndex)
  }

	/**
	 * Synchronously flushes in memory data to disk. Not required to update metadata.
	 * @param fdIndex number. File descriptor index.
	 * @returns void.
	 */
  fdatasyncSync(
    fdIndex: number
  ): void {
    return this.upperDir.fdatasyncSync(fdIndex)
  }

	/**
	 * Asynchronously retrieves data about the file described by fdIndex.
	 * @param fd number. File descriptor.
	 * @returns void.
	 */
  async fstat(
    fd: number
  ): Promise<fs.Stats> {
    return await promisify(this.upperDir.fstat)(fd)
  }

	/**
	 * Synchronously retrieves data about the file described by fdIndex.
	 * @param fd number. File descriptor.
	 * @returns void.
	 */
  fstatSync(
    fd: number
  ): fs.Stats {
    return this.upperDir.fstatSync(fd)
  }

	/**
	 * Synchronously flushes all modified data to disk.
	 * @param fdIndex number. File descriptor index.
	 * @returns void.
	 */
  async fsync(
    fdIndex: number
  ): Promise<void> {
    return await promisify(this.upperDir.fsync)(fdIndex)
  }

	/**
	 * Synchronously flushes all modified data to disk.
	 * @param fdIndex number. File descriptor index.
	 * @returns void.
	 */
  fsyncSync(
    fdIndex: number
  ): void {
    return this.upperDir.fsyncSync(fdIndex)
  }

	/**
	 * Asynchronously truncates to given length.
	 * @param fdIndex number. File descriptor index
	 * @param len number. Length to truncate to.
	 * @returns void.
	 */
  async ftruncate(
    fdIndex: number,
    len: number = 0
  ): Promise<void> {
    return await promisify(this.upperDir.ftruncate)(fdIndex, len)
  }

	/**
	 * Synchronously truncates to given length.
	 * @param fdIndex number. File descriptor index
	 * @param len number. Length to truncate to.
	 * @returns void.
	 */
  ftruncateSync(
    fdIndex: number,
    len: number = 0
  ): void {
    return this.upperDir.ftruncateSync(fdIndex, len)
  }

	/**
	 * Asynchronously changes the access and modification times of the file referenced by fdIndex.
	 * @param fdIndex number. File descriptor index
	 * @param atime number | string | Date. Access time.
	 * @param mtime number | string | Date. Modification time.
	 * @returns void.
	 */
  async futimes(
    fdIndex: number,
    atime: number | string | Date,
    mtime: number | string | Date
  ): Promise<void> {
    return await promisify(this.upperDir.futimes)(fdIndex, atime, mtime)
  }

	/**
	 * Synchronously changes the access and modification times of the file referenced by fdIndex.
	 * @param fdIndex number. File descriptor index
	 * @param atime number | string | Date. Access time.
	 * @param mtime number | string | Date. Modification time.
	 * @returns void.
	 */
  futimesSync(
    fdIndex: number,
    atime: number | string | Date,
    mtime: number | string | Date
  ): void {
    return this.upperDir.futimesSync(fdIndex, atime, mtime)
  }

	/**
	 * Synchronously links a path to a new path.
	 * @param existingPath string.
	 * @param newPath string.
	 * @returns void.
	 */
  async link(
    existingPath: fs.PathLike,
    newPath: fs.PathLike
  ): Promise<void> {
    await promisify(this.upperDir.link)(existingPath, newPath)
    await promisify(this.lowerDir.link)(existingPath, newPath)
  }

	/**
	 * Synchronously links a path to a new path.
	 * @param existingPath string.
	 * @param newPath string.
	 * @returns void.
	 */
  linkSync(
    existingPath: fs.PathLike,
    newPath: fs.PathLike
  ): void {
    this.lowerDir.linkSync(existingPath, newPath)
    this.upperDir.linkSync(existingPath, newPath)
  }

	/**
	 * Synchronously reads data from a file given the path of that file.
	 * @param path string. Path to file.
	 * @returns void.
	 */
  async readFile(
    path: fs.PathLike | number,
    options?: fs.WriteFileOptions
  ): Promise<string | Buffer> {
    const optionsInternal = this.getFileOptions(
      { encoding: null, mode: 0o666, flag: "r" },
      options,
    )
    let fd: number | null = null
    try {
      if (typeof path === 'number') {
        fd = <number>path
      } else {
        fd = await this.open(path, optionsInternal.flag, optionsInternal.mode)
      }
      const size = this.getMetadata(fd).size
      const readBuffer = Buffer.alloc(size)
      await this.read(fd, readBuffer)
      return (optionsInternal.encoding) ? readBuffer.toString(optionsInternal.encoding) : readBuffer
    } catch (err) {
      throw(err)
    } finally {
      if (fd) {
        await this.close(fd)
      }
    }
  }

	/**
	 * Synchronously reads data from a file given the path of that file.
	 * @param path string. Path to file.
	 * @returns Buffer (read buffer).
	 */
  readFileSync(
    path: fs.PathLike | number,
    options?: fs.WriteFileOptions
  ): string | Buffer {
    const optionsInternal = this.getFileOptions(
      { encoding: null, mode: 0o666, flag: "r" },
      options,
    )
    let fd: number | null = null
    try {
      if (typeof path === 'number') {
        fd = <number>path
      } else {
        fd = this.openSync(path, optionsInternal.flag, optionsInternal.mode)
      }
      // Check if file descriptor points to directory
      if (this.fstatSync(fd).isDirectory()) {
        throw (new EncryptedFSError(errno.EISDIR, null, null, 'read'))
      }
      const size = this.getMetadata(fd).size
      const readBuffer = Buffer.alloc(size)
      this.readSync(fd, readBuffer, 0, size, 0)
      return (optionsInternal.encoding) ? readBuffer.toString(optionsInternal.encoding) : readBuffer
    } finally {
      if (fd) {
        this.closeSync(fd)
      }
    }
  }

	/**
	 * Synchronously reads link of the given the path. Propagated from upper fs.
	 * @param path string. Path to file.
	 * @param options FileOptions | undefined.
	 * @returns Buffer | string.
	 */
  async readlink(
    path: fs.PathLike,
    options: fs.WriteFileOptions | undefined = undefined
  ): Promise<Buffer | string> {
    try {
      return this.upperDir.readlinkSync(path, options)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously reads link of the given the path. Propagated from upper fs.
	 * @param path string. Path to file.
	 * @param options FileOptions | undefined.
	 * @returns string | Buffer.
	 */
  readlinkSync(
    path: fs.PathLike,
    options: fs.WriteFileOptions | undefined = undefined
  ): string | Buffer {
    return this.upperDir.readlinkSync(path, options)
  }

	/**
	 * Asynchronously determines the actual location of path. Propagated from upper fs.
	 * @param path string. Path to file.
	 * @param options FileOptions | undefined.
	 * @returns void.
	 */
  async realpath(
    path: fs.PathLike,
    options: fs.WriteFileOptions | undefined = undefined
  ): Promise<string> {
    try {
      return await promisify(this.upperDir.realpath)(path, options)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously determines the actual location of path. Propagated from upper fs.
	 * @param path string. Path to file.
	 * @param options FileOptions | undefined.
	 * @returns Buffer (read buffer).
	 */
  realpathSync(
    path: fs.PathLike,
    options: fs.WriteFileOptions | undefined = undefined
  ): string | Buffer {
    return this.upperDir.realpathSync(path, options)
  }

	/**
	 * Asynchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
	 * @param oldPath string. Old path.
	 * @param oldPath string. New path.
	 * @returns void.
	 */
  async rename(
    oldPath: fs.PathLike,
    newPath: fs.PathLike
  ): Promise<void> {
    try {
      this.upperDir.renameSync(oldPath, newPath)
      await promisify(this.lowerDir.rename)(oldPath, newPath)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
	 * @param oldPath string. Old path.
	 * @param oldPath string. New path.
	 * @returns void.
	 */
  renameSync(
    oldPath: fs.PathLike,
    newPath: fs.PathLike
  ): void {
    return this.upperDir.renameSync(oldPath, newPath)
  }

	/**
	 * Asynchronously reads data at an offset, position and length from a file descriptor into a given buffer.
	 * @param fd number. File descriptor.
	 * @param buffer Buffer. Buffer to be written from.
	 * @param offset number. Offset of the data.
	 * @param length number. Length of data to write.
	 * @param position number. Where to start writing.
	 * @returns Promise<number>.
	 */
  async read(
    fd: number,
    buffer: Buffer,
    offset: number = 0,
    length: number = buffer.length,
    position: number = 0
  ): Promise<number> {
    if (typeof position === 'number' && position < 0) {
      throw new EncryptedFSError(errno.EINVAL, null, null, 'read');
    }
    // Check if file descriptor points to directory
    if (this.fstatSync(fd).isDirectory()) {
      throw (new EncryptedFSError(errno.EISDIR, null, null, 'read'))
    }
    try {
      const lowerFd = this.getLowerFd(fd)
      const metadata = this.getMetadata(fd)
      if (position + length > metadata.size) {
        length = metadata.size - position
      }

      // Init counters for incremental reading of blocks
      let bytesRead = 0
      let targetStart = offset

      // Determine chunk boundary conditions
      const numChunksToRead = Math.ceil(length / this.blockSize)
      const startBlockNum = this.offsetToBlockNum(position)
      const startChunkNum = startBlockNum

      // Initialize write boundary conditions
      let blockBufferStart = this.getBoundaryOffset(position)

      // Begin reading chunks
      for (let chunkCtr = startChunkNum; (chunkCtr - startChunkNum) < numChunksToRead; chunkCtr++) {
        // Read the current block into chunkBuffer
        const chunkPosition = this.chunkNumToOffset(chunkCtr)
        const chunkBuffer = Buffer.alloc(this.chunkSize)
        await promisify(this.lowerDir.read)(lowerFd, chunkBuffer, 0, this.chunkSize, chunkPosition)

        // Extract blockBuffer from chukBuffer
        const blockBuffer = await this.crypto.decryptChunk(chunkBuffer)

        // Determine end condition of blockBuffer to write to
        const blockBufferEnd = (length > bytesRead + blockBuffer.length) ? blockBuffer.length : length - (chunkCtr * this.blockSize)

        // Write blockBuffer to buffer
        const blockBytesRead = blockBuffer.copy(buffer, targetStart, blockBufferStart, blockBufferEnd)

        // Increment boundary variables
        bytesRead += blockBytesRead
        targetStart += blockBytesRead
        blockBufferStart += blockBytesRead
      }
      return bytesRead
    } catch (err) {
      throw(err)
    }
  }

  // TODO: validation of the params?
  // TODO: what to do if buffer is less than 4k? truncate?
  // TODO: what happens if length is larger than buffer?
  // So if the file contains a 100 bytes, and you read 4k, then you will read those 100 into
  // the buffer at the specified offset. But after those 100 bytes, what ever was in the buffer will remain
	/**
	 * Synchronously reads data at an offset, position and length from a file descriptor into a given buffer.
	 * @param fd number. File descriptor.
	 * @param buffer Buffer. Buffer to be read into.
	 * @param offset number. Offset of the data.
	 * @param length number. Length of data to write.
	 * @param position number. Where to start writing.
	 * @returns number (length).
	 */
  readSync(
    fd: number,
    buffer: Buffer,
    offset: number = 0,
    length: number = buffer.length,
    position: number = 0,
  ): number {
    if (typeof position === 'number' && position < 0) {
      throw new EncryptedFSError(errno.EINVAL, null, null, 'readSync');
    }
    // Check if file descriptor points to directory
    if (this.fstatSync(fd).isDirectory()) {
      throw (new EncryptedFSError(errno.EISDIR, null, null, 'readSync'))
    }
    try {
      const lowerFd = this.getLowerFd(fd)
      const metadata = this.getMetadata(fd)
      if (position + length > metadata.size) {
        length = metadata.size - position
      }

      // Accumulate plain text blocks in buffer array
      const blockBuffers: Buffer[] = []

      // Determine chunk boundary conditions
      const numChunksToRead = Math.ceil(length / this.blockSize)
      const startBlockNum = this.offsetToBlockNum(position)
      const startChunkNum = startBlockNum

      // Begin reading chunks
      for (let chunkCtr = startChunkNum; (chunkCtr - startChunkNum) < numChunksToRead; chunkCtr++) {
        // Read the current block into chunkBuffer
        const chunkPosition = this.chunkNumToOffset(chunkCtr)
        const chunkBuffer = Buffer.alloc(this.chunkSize)
        this.lowerDir.readSync(lowerFd, chunkBuffer, 0, this.chunkSize, chunkPosition)

        // Extract blockBuffer from chukBuffer
        const tempBlockBuffer = this.crypto.decryptChunkSync(chunkBuffer)
        blockBuffers.push(tempBlockBuffer)
      }

      // Create buffer of all read blockBuffers
      const blockBuffer = Buffer.concat(
        blockBuffers,
        numChunksToRead * this.blockSize
      )

      // Determine end condition of blockBuffer to write to
      const blockBufferStart = this.getBoundaryOffset(position)
      const blockBufferEnd = blockBufferStart + length

      return blockBuffer.copy(buffer, offset, blockBufferStart, blockBufferEnd)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Asynchronously writes buffer (with length) to the file descriptor at an offset and position.
	 * @param fd number. File descriptor.
	 * @param buffer Buffer. Buffer to be written from.
	 * @param offset number. Offset of the data.
	 * @param length number. Length of data to write.
	 * @param position number. Where to start writing.
	 * @returns Promise<number>.
	 */
  async write(
    fd: number,
    buffer: Buffer,
    offset: number = 0,
    length: number = buffer.length,
    position: number = 0
  ): Promise<number> {
    if (typeof position === 'number' && position < 0) {
      throw new EncryptedFSError(errno.EINVAL, null, null, 'write');
    }
    // Check if file descriptor points to directory
    if (this.fstatSync(fd).isDirectory()) {
      throw (new EncryptedFSError(errno.EISDIR, null, null, 'write'))
    }
    try {
      // Discriminate upper and lower file descriptors
      const upperFd = fd
      const lowerFd = this.getLowerFd(fd)

      // Get block boundary conditions
      const boundaryOffset = this.getBoundaryOffset(position) // how far from a block boundary our write is
      const numBlocksToWrite = Math.ceil((boundaryOffset + length) / this.blockSize)
      const startBlockNum = this.offsetToBlockNum(position)
      const startChunkNum = startBlockNum
      const endBlockNum = startBlockNum + numBlocksToWrite - 1

      let bufferBytesWritten: number = 0

      // ================== Handle first block ================== //
      const startBlockOverlaySize = this.blockSize - boundaryOffset
      // Write new data to block
      const startBlockOverlay = buffer.slice(offset, startBlockOverlaySize)
      const startBlock = await this.overlaySegment(upperFd, startBlockOverlay, position)
      const startChunk = await this.crypto.encryptBlock(startBlock)
      bufferBytesWritten += startBlockOverlay.length

      // ================== Handle end block if needed ================== //
      const endBlockBufferOffset = startBlockOverlaySize + (numBlocksToWrite - 2) * this.blockSize
      let endBlock: Buffer | null
      let endChunk: Buffer | null
      if (numBlocksToWrite >= 2) {
        const endBlockOverlay = buffer.slice(offset + endBlockBufferOffset)
        const endBlockOffset = this.blockNumToOffset(endBlockNum)
        endBlock = await this.overlaySegment(upperFd, endBlockOverlay, endBlockOffset)
        endChunk = await this.crypto.encryptBlock(endBlock)
        bufferBytesWritten += endBlockOverlay.length
      } else {
        endBlock = null
        endChunk = null
      }

      // ================== Handle middle blocks if needed ================== //
      // slice out middle blocks if they actually exist
      let middleBlocks: Buffer[] = []
      let middleChunks: Buffer[] = []
      if (numBlocksToWrite >= 3) {
        const middleBlockBuffer = buffer.slice(startBlockOverlaySize, endBlockBufferOffset)

        const blockIter = this.blockGenerator(middleBlockBuffer)
        let middleBlockCtr = startBlockNum + 1
        for (let block of blockIter) {
          const middleBlockOffset = this.blockNumToOffset(middleBlockCtr)
          const middleBlock = await this.overlaySegment(upperFd, block, middleBlockOffset)
          const middleChunk = await this.crypto.encryptBlock(middleBlock)
          middleBlocks.push(middleBlock)
          middleChunks.push(middleChunk)
          middleBlockCtr += 1
          bufferBytesWritten += block.length
        }
      }

      // ================== Concat blocks and write ================== //
      let totalBlocks: Buffer[] = []
      totalBlocks.push(startBlock)
      totalBlocks.push(...middleBlocks)
      if (endBlock) {
        totalBlocks.push(endBlock)
      }
      const blocks = Buffer.concat(totalBlocks, this.blockSize * numBlocksToWrite)
      // Write to upperDir (unencrypted)
      await promisify(this.upperDir.write)(
        upperFd,
        blocks,
        0,
        blocks.length,
        this.blockNumToOffset(startBlockNum)
      )

      // ================== Concat chunks and write ================== //
      let totalChunks: Buffer[] = []
      totalChunks.push(startChunk)
      totalChunks.push(...middleChunks)
      if (endChunk) {
        totalChunks.push(endChunk)
      }
      const chunks = Buffer.concat(totalChunks, this.chunkSize * numBlocksToWrite)
      // Write to lowerDir (encrypted)
      await promisify(this.lowerDir.write)(
        lowerFd,
        chunks,
        0,
        chunks.length,
        this.chunkNumToOffset(startChunkNum)
      )

      // ================== Handle and write metadata ================== //
      const newFileSize = position + length
      if (newFileSize > this.getMetadata(upperFd).size) {
        this.getMetadata(upperFd).size = newFileSize
        this.writeMetadataSync(upperFd)
      }

      return bufferBytesWritten
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
	 * @param fd number. File descriptor.
	 * @param buffer Buffer. Buffer to be written from.
	 * @param offset number. Offset of the data.
	 * @param length number. Length of data to write.
	 * @param position number. Where to start writing.
	 * @returns number (length).
	 */
  writeSync(
    fd: number,
    buffer: Buffer,
    offset: number = 0,
    length: number = buffer.length,
    position: number = 0
  ): number {
    if (typeof position === 'number' && position < 0) {
      throw new EncryptedFSError(errno.EINVAL, null, null, 'writeSync');
    }
    // Check if file descriptor points to directory
    if (this.fstatSync(fd).isDirectory()) {
      throw (new EncryptedFSError(errno.EISDIR, null, null, 'writeSync'))
    }
    try {
      // Discriminate upper and lower file descriptors
      const upperFd = fd
      const lowerFd = this.getLowerFd(fd)

      // Get block boundary conditions
      const boundaryOffset = this.getBoundaryOffset(position) // how far from a block boundary our write is
      const numBlocksToWrite = Math.ceil((boundaryOffset + length) / this.blockSize)
      const startBlockNum = this.offsetToBlockNum(position)
      const startChunkNum = startBlockNum
      const endBlockNum = startBlockNum + numBlocksToWrite - 1

      let bufferBytesWritten: number = 0

      // ================== Handle first block ================== //
      const startBlockOverlaySize = this.blockSize - boundaryOffset
      // Write new data to block
      const startBlockOverlay = buffer.slice(offset, startBlockOverlaySize)
      const startBlock = this.overlaySegmentSync(upperFd, startBlockOverlay, position)
      const startChunk = this.crypto.encryptBlockSync(startBlock)
      bufferBytesWritten += startBlockOverlay.length

      // ================== Handle end block if needed ================== //
      const endBlockBufferOffset = startBlockOverlaySize + (numBlocksToWrite - 2) * this.blockSize
      let endBlock: Buffer | null
      let endChunk: Buffer | null
      if (numBlocksToWrite >= 2) {
        const endBlockOverlay = buffer.slice(offset + endBlockBufferOffset)
        const endBlockOffset = this.blockNumToOffset(endBlockNum)
        endBlock = this.overlaySegmentSync(upperFd, endBlockOverlay, endBlockOffset)
        endChunk = this.crypto.encryptBlockSync(endBlock)
        bufferBytesWritten += endBlockOverlay.length
      } else {
        endBlock = null
        endChunk = null
      }

      // ================== Handle middle blocks if needed ================== //
      // slice out middle blocks if they actually exist
      let middleBlocks: Buffer[] = []
      let middleChunks: Buffer[] = []
      if (numBlocksToWrite >= 3) {
        const middleBlockBuffer = buffer.slice(startBlockOverlaySize, endBlockBufferOffset)

        const blockIter = this.blockGenerator(middleBlockBuffer)
        let middleBlockCtr = startBlockNum + 1
        for (let block of blockIter) {
          const middleBlockOffset = this.blockNumToOffset(middleBlockCtr)
          const middleBlock = this.overlaySegmentSync(upperFd, block, middleBlockOffset)
          const middleChunk = this.crypto.encryptBlockSync(middleBlock)
          middleBlocks.push(middleBlock)
          middleChunks.push(middleChunk)
          middleBlockCtr += 1
          bufferBytesWritten += block.length
        }
      }

      // ================== Concat blocks and write ================== //
      let totalBlocks: Buffer[] = []
      totalBlocks.push(startBlock)
      totalBlocks.push(...middleBlocks)
      if (endBlock) {
        totalBlocks.push(endBlock)
      }

      const blocks = Buffer.concat(totalBlocks, this.blockSize * numBlocksToWrite)
      // Write to upperDir (unencrypted)
      this.upperDir.writeSync(
        upperFd,
        blocks,
        0,
        blocks.length,
        this.blockNumToOffset(startBlockNum)
      )

      // ================== Concat chunks and write ================== //
      let totalChunks: Buffer[] = []
      totalChunks.push(startChunk)
      totalChunks.push(...middleChunks)
      if (endChunk) {
        totalChunks.push(endChunk)
      }
      const chunks = Buffer.concat(totalChunks, this.chunkSize * numBlocksToWrite)
      // Write to lowerDir (encrypted)
      this.lowerDir.writeSync(
        lowerFd,
        chunks,
        0,
        chunks.length,
        this.chunkNumToOffset(startChunkNum)
      )

      // ================== Handle and write metadata ================== //
      const newFileSize = position + length
      if (newFileSize > this.getMetadata(fd).size) {
        this.getMetadata(fd).size = newFileSize
        this.writeMetadataSync(fd)
      }

      return bufferBytesWritten
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Asynchronously append data to a file, creating the file if it does not exist.
	 * @param file string | number. Path to the file or directory.
	 * @param data string | Buffer. The data to be appended.
	 * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
	 * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
	 * @returns Promise<void>.
	 */
  async appendFile(
    file: fs.PathLike | number,
    data: Buffer,
    options?: fs.WriteFileOptions
  ): Promise<void> {
    const optionsInternal = this.getFileOptions(
      { encoding: 'utf8', mode: 0o666, flag: 'a' },
      options,
    )
    let fd: number | null = null
    try {
      // Get file descriptor
      if (typeof file === 'number') {
        fd = file
      } else {
        fd = await this.open(file, optionsInternal.flag, optionsInternal.mode)
      }
      const upperFd = this.getUpperFd(fd)
      const lowerFd = this.getLowerFd(fd)
      await promisify(this.lowerDir.appendFile)(lowerFd, data, optionsInternal)
    } catch (err) {
      throw(err)
    } finally {
      if (fd) {
        await this.close(fd)
      }
    }
  }

	/**
	 * Synchronously append data to a file, creating the file if it does not exist.
	 * @param path string | number. Path to the file or directory.
	 * @param data string | Buffer. The data to be appended.
	 * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
	 * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
	 * @returns Promise<void>.
	 */
  appendFileSync(
    file: fs.PathLike | number,
    data: Buffer,
    options?: fs.WriteFileOptions
  ): void {
    const optionsInternal = this.getFileOptions(
      { encoding: 'utf8', mode: 0o666, flag: 'a' },
      options,
    )
    let fd: number | null = null
    try {
      // Get file descriptor
      if (typeof file === 'number') {
        fd = file
      } else {
        fd = this.openSync(file, optionsInternal.flag, optionsInternal.mode)
      }
      const upperFd = this.getUpperFd(fd)
      const lowerFd = this.getLowerFd(fd)
      this.lowerDir.appendFileSync(lowerFd, data, optionsInternal)
    } catch (err) {
      throw(err)
    } finally {
      if (fd) {
        this.closeSync(fd)
      }
    }
  }

	/**
	 * Asynchronously changes the access permissions of the file system object described by path.
	 * @param path string. Path to the fs object.
	 * @param mode number. New permissions set.
	 * @returns void.
	 */
  async chmod(
    path: fs.PathLike,
    mode: number = 0
  ): Promise<void> {
    try {
      await promisify(this.upperDir.chmod)(path, mode)
      await promisify(this.lowerDir.chmod)(path, mode)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously changes the access permissions of the file system object described by path.
	 * @param path string. Path to the fs object.
	 * @param mode number. New permissions set.
	 * @returns void.
	 */
  chmodSync(
    path: fs.PathLike,
    mode: number = 0
  ): void {
    this.upperDir.chmodSync(path, mode)
    this.lowerDir.chmodSync(path, mode)
  }

	/**
	 * Synchronously changes the owner or group of the file system object described by path.
	 * @param path string. Path to the fs object.
	 * @param uid number. User identifier.
	 * @param gid number. Group identifier.
	 * @returns void.
	 */
  async chown(
    path: fs.PathLike,
    uid: number,
    gid: number
  ): Promise<void> {
    try {
      await promisify(this.upperDir.chown)(path, uid, gid)
      await promisify(this.lowerDir.chown)(path, uid, gid)
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously changes the owner or group of the file system object described by path.
	 * @param path string. Path to the fs object.
	 * @param uid number. User identifier.
	 * @param gid number. Group identifier.
	 * @returns void.
	 */
  chownSync(
    path: fs.PathLike,
    uid: number,
    gid: number
  ): void {
    this.upperDir.chownSync(path, uid, gid)
    this.lowerDir.chownSync(path, uid, gid)
  }

	/**
	 * Asynchronously writes data to the path specified with some FileOptions.
	 * @param path string | number. Path to the file or directory.
	 * @param data string | Buffer. The data to be written.
	 * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined } | undefined
	 * @returns void.
	 */
  async writeFile(
    path: fs.PathLike | number,
    data: string | Buffer,
    options: fs.WriteFileOptions = {}
  ): Promise<void> {
    try {
      const optionsInternal = this.getFileOptions(
        { encoding: 'utf8', mode: 0o666, flag: 'w' },
        options,
      )
      const isUserFileDescriptor = this.isFileDescriptor(path)
      let fd: number
      if (isUserFileDescriptor) {
        fd = <number>path
      } else if (typeof path == 'string') {
        fd = await this.open(path, optionsInternal.flag, optionsInternal.mode)
      } else {
        throw new EncryptedFSError(errno.EBADF, null, null, 'writeFile')
      }
      let offset = 0
      if (typeof data === 'string') {
        data = Buffer.from(data)
      }
      let length = data.byteLength

      // const position = /a/.test(flag) ? null : 0
      let position = 0

      while (length > 0) {
        const written = await this.write(fd, data, offset, length, position)
        offset += written
        length -= written
        if (position !== null) {
          position += written
        }
      }
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Synchronously writes data to the path specified with some FileOptions.
	 * @param path string | number. Path to the file or directory.
	 * @param data string | Buffer. Defines the data to be .
	 * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
	 * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
	 * @returns void.
	 */
  writeFileSync(
    path: fs.PathLike | number,
    data: string | Buffer,
    options: fs.WriteFileOptions = {},
  ): void {
    try {
      const optionsInternal = this.getFileOptions(
        { encoding: 'utf8', mode: 0o666, flag: 'w' },
        options,
      )
      const isUserFileDescriptor = this.isFileDescriptor(path)
      let fd: number
      if (isUserFileDescriptor) {
        fd = <number>path
      } else if (typeof path === 'string') {
        fd = this.openSync(path, optionsInternal.flag, optionsInternal.mode)
      } else {
        throw new EncryptedFSError(errno.EBADF, null, null, 'writeFileSync')
      }
      let offset = 0
      if (typeof data === 'string') {
        data = Buffer.from(data)
      }
      let length = data.byteLength

      // let position = /a/.test(flag) ? null : 0
      let position = 0

      while (length > 0) {
        const written = this.writeSync(fd, data, offset, length, position)
        offset += written
        length -= written
        if (position !== null) {
          position += written
        }
      }
    } catch (err) {
      throw(err)
    }
  }

	/**
	 * Asynchronously opens a file or directory and returns the file descriptor.
	 * @param path string. Path to the file or directory.
	 * @param flags string. Flags for read/write operations. Defaults to 'r'.
	 * @param mode number. Read and write permissions. Defaults to 0o666.
	 * @returns Promise<number>
	 */
  async open(
    path: fs.PathLike,
    flags: number | string = 'r',
    mode: number | string = 0o666
  ): Promise<number> {
    try {
      const _path = this.getPath(path)
      // Open on lowerDir
      let lowerFd = await promisify(this.lowerDir.open)(_path, flags, mode)
      // Check if a file
      if ((await promisify(this.lowerDir.fstat)(lowerFd)).isFile()) {
        // Open with write permissions as well
        await promisify(this.lowerDir.close)(lowerFd)
        const lowerFlags = flags[0] === "w" ? "w+" : "r+"
        lowerFd = await promisify(this.lowerDir.open)(_path, lowerFlags, mode)
      }
      const upperFilePath = Path.resolve(_path)
      // Need to make path if it doesn't exist already
      if (!this.upperDir.existsSync(upperFilePath)) {
        const upperFilePathDir = Path.dirname(upperFilePath)
        // mkdirp
        await promisify(this.upperDir.mkdirp)(upperFilePathDir)
        // create file if needed
        await promisify(this.upperDir.close)(await promisify(this.upperDir.open)(upperFilePath, "w"))
      }
      // Open on upperDir
      const upperFd = await promisify(this.upperDir.open)(upperFilePath, flags, mode)
      // Create efsFd
      const efsFd = new FileDescriptor(lowerFd, upperFd, flags.toString())
      this.fileDescriptors.set(upperFd, efsFd)

      // If file descriptor points to file, write metadata
      const isFile = this.fstatSync(upperFd)?.isFile()
      if (isFile) {
        if (flags[0] === "r") {
          await this.loadMetadata(upperFd)
        } else if (flags[0] === "w") {
          const hash = this.crypto.hashSync(this.masterKey)
          this.metadata[upperFd] = { keyHash: hash, size: 0 }
          this.writeMetadataSync(upperFd)
        }
      }
      return upperFd
    } catch (err) {
      throw(err)
    }
  }

  // TODO: actually implement flags
  // TODO: w+ should truncate, r+ should not
	/**
	 * Synchronously opens a file or directory and returns the file descriptor.
	 * @param path string. Path to the file or directory.
	 * @param flags string. Flags for read/write operations. Defaults to 'r'.
	 * @param mode number. Read and write permissions. Defaults to 0o666.
	 * @returns number (file descriptor in the upperDir).
	 */
  openSync(
    path: fs.PathLike,
    flags: number | string = 'r',
    mode: number | string = 0o666
  ): number {
    try {
      const _path = this.getPath(path)
      // Open on lowerDir
      let lowerFd = this.lowerDir.openSync(_path, flags, mode)
      // Check if a directory
      if (this.lowerDir.fstatSync(lowerFd).isFile()) {
        // Open with write permissions as well
        this.lowerDir.closeSync(lowerFd)
        const lowerFlags = flags[0] === "w" ? "w+" : "r+"
        lowerFd = this.lowerDir.openSync(_path, lowerFlags, mode)
      }
      const upperFilePath = Path.resolve(_path)
      // Need to make path if it doesn't exist already
      if (!this.upperDir.existsSync(upperFilePath)) {
        const upperFilePathDir = Path.dirname(upperFilePath)
        // mkdirp
        this.upperDir.mkdirpSync(upperFilePathDir)
        // create file if needed
        this.upperDir.closeSync(this.upperDir.openSync(upperFilePath, 'w'))
      }
      // Open on upperDir
      const upperFd = this.upperDir.openSync(upperFilePath, flags, mode)
      // Create efsFd
      const efsFd = new FileDescriptor(lowerFd, upperFd, flags.toString())
      this.fileDescriptors.set(upperFd, efsFd)

      // If file descriptor points to file, write metadata
      const isFile = this.fstatSync(upperFd)?.isFile()
      if (isFile) {
        if (flags[0] === "r") {
          this.loadMetadataSync(upperFd)
        } else if (flags[0] === "w") {
          const hash = this.crypto.hashSync(this.masterKey)
          this.metadata[upperFd] = { keyHash: hash, size: 0 }
          this.writeMetadataSync(upperFd)
        }
      }
      return upperFd
    } catch (err) {
      throw (err)
    }
  }

	/**
	 * Get key used for encryption.
	 * @returns Buffer | string (Key)
	 */
  getKey(): Buffer | string {
    return this.masterKey
  }

  private getFileOptions(defaultOptions: Object, options?: fs.WriteFileOptions): { encoding?: string | null, mode?: string | number, flag?: string } {
    let optionsFinal: fs.WriteFileOptions = defaultOptions
    if (typeof options === "string") {
      if (!this.isCharacterEncoding(options)) {
        throw Error('Invalid encoding string')
      }
      return { ...defaultOptions, encoding: options }
    }
    if (options) {
      if (options.encoding) {
        if (this.isCharacterEncoding(options.encoding)) {
          optionsFinal = { ...optionsFinal, encoding: options.encoding }
        } else {
          throw Error('Invalid encoding string')
        }
      }
      if (options.flag) {
        optionsFinal = { ...optionsFinal, flag: options.flag }
      }
      if (options.mode) {
        optionsFinal = { ...optionsFinal, mode: options.mode }
      }
    }
    return optionsFinal
  }

  private getStreamOptions(defaultOptions: optionsStream, options?: optionsStream): optionsStream {
    let optionsFinal: optionsStream = defaultOptions
    if (typeof options === "string") {
      if (!this.isCharacterEncoding(options)) {
        throw Error('Invalid encoding string')
      }
      return { ...defaultOptions, encoding: options }
    }
    if (options) {
      if (options.highWaterMark) {
        optionsFinal = { ...optionsFinal, highWaterMark: options.highWaterMark }
      }
      if (options.flags) {
        optionsFinal = { ...optionsFinal, flags: options.flags }
      }
      if (options.encoding) {
        if (this.isCharacterEncoding(options.encoding)) {
          optionsFinal = { ...optionsFinal, encoding: options.encoding }
        } else {
          throw Error('Invalid encoding string')
        }
      }
      if (options.fd) {
        optionsFinal = { ...optionsFinal, fd: options.fd }
      }
      if (options.mode) {
        optionsFinal = { ...optionsFinal, mode: options.mode }
      }
      if (options.autoClose) {
        optionsFinal = { ...optionsFinal, autoClose: options.autoClose }
      }
      if (options.start) {
        optionsFinal = { ...optionsFinal, start: options.start }
      }
      if (options.end) {
        optionsFinal = { ...optionsFinal, end: options.end }
      }
    }
    return optionsFinal
  }

  private isCharacterEncoding(encoding: string | null | undefined): encoding is BufferEncoding {
    if (encoding == null || encoding == undefined) {
      return false
    }

    return ['ascii', 'utf8', 'utf-8', 'utf16le', 'ucs2', 'ucs-2', 'base64', 'latin1', 'binary', 'hex'].includes(encoding)
  }


  // ========= HELPER FUNCTIONS =============
	/**
	 * Asynchronously reads the whole block that the position lies within.
	 * @param fd File descriptor.
	 * @param position Position of data required.
	 * @returns Buffer.
	 */
  private async readBlock(fd: number, position: number): Promise<Buffer> {
    // Returns zero buffer if file has no content
    if (this.positionOutOfBounds(fd, position)) {
      return Buffer.alloc(this.blockSize)
    }

    const blockNum = this.offsetToBlockNum(position)
    const blockOffset = this.blockNumToOffset(blockNum)
    // TODO: optimisation: if we can ensure that readSync will always write blockSize, then we can use allocUnsafe
    const blockBuf = Buffer.alloc(this.blockSize)

    await this.read(fd, blockBuf, 0, this.blockSize, blockOffset)

    return blockBuf
  }

	/**
	 * Synchronously reads the whole block that the position lies within.
	 * @param fd File descriptor.
	 * @param position Position of data required.
	 * @returns Buffer.
	 */
  private readBlockSync(fd: number, position: number): Buffer {
    // Returns zero buffer if file has no content
    if (this.positionOutOfBounds(fd, position)) {
      return Buffer.alloc(this.blockSize)
    }

    const blockNum = this.offsetToBlockNum(position)
    const blockOffset = this.blockNumToOffset(blockNum)
    // TODO: optimisation: if we can ensure that readSync will always write blockSize, then we can use allocUnsafe
    const blockBuf = Buffer.alloc(this.blockSize)

    this.readSync(fd, blockBuf, 0, this.blockSize, blockOffset)

    return blockBuf
  }

  // #TODO:
  // TODO: what happens if file is less than block size?
	/**
	 * Asynchronously reads from disk the chunk containing the block that needs to be merged with new block
	 * @param fd File descriptor.
	 * @param newData Buffer containing the new data.
	 * @param position Position of the insertion.
	 * @returns Buffer (a plaintext buffer containing the merge blocks in a single block).
	 */
  private async overlaySegment(fd: number, newData: Buffer, position: number): Promise<Buffer> {
    // 	case 1:  segment is aligned to start of block and ends at end of block      |<------->|
    // 	case 2:  segment is aligned to start-of-block but end before end-of-block   |<----->--|
    // 	case 3:  segment is not aligned to start and ends before end-of-block       |--<--->--|
    // 	case 4:  segment is not aligned to start-of-block and ends at end-of-block  |--<----->|
    //
    // 	Cases 3 and 4 are not possible when overlaying the last segment

    const writeOffset = this.getBoundaryOffset(position) // byte offset from where to start writing new data in the block

    // Optimization: skip read if newData is block size and position is writeOffset is 0
    if (writeOffset === 0 && newData.length === this.blockSize) {
      return newData
    }

    // Make sure newData won't be written over block boundary
    if (writeOffset + newData.length > this.blockSize) {
      throw(new EncryptedFSError(errno.EINVAL, null, null,'overlaySegment'))
    }

    // Read relevant block
    const originalBlock = await this.readBlock(fd, position)


    const isBlockStartAligned = writeOffset === 0
    // Get the start slice if newData is not block start aligned
    let startSlice = Buffer.alloc(0)
    if (!isBlockStartAligned) {
      startSlice = originalBlock.slice(0, writeOffset)
    }

    // Any data reamining after new block
    const endSlice = originalBlock.slice(writeOffset + newData.length)

    // Patch up slices to create new block
    const newBlock = Buffer.concat([startSlice, newData, endSlice])

    return newBlock
  }

	/**
	 * Synchronously Reads from disk the chunk containing the block that needs to be merged with new block
	 * @param fd File descriptor.
	 * @param newData Buffer containing the new data.
	 * @param position Position of the insertion.
	 * @returns Buffer (a plaintext buffer containing the merge blocks in a single block).
	 */
  private overlaySegmentSync(fd: number, newData: Buffer, position: number): Buffer {
    const writeOffset = this.getBoundaryOffset(position) // byte offset from where to start writing new data in the block

    // Optimization: skip read if newData is block aligned and length is blockSize
    if (writeOffset === 0 && newData.length === this.blockSize) {
      return newData
    }

    // Make sure newData won't be written over block boundary
    if (writeOffset + newData.length > this.blockSize) {
      throw(new EncryptedFSError(errno.EINVAL, null, null, 'overlaySegmentSync'))
    }

    // Read relevant block
    const originalBlock = this.readBlockSync(fd, position)


    const isBlockStartAligned = writeOffset === 0
    // Get the start slice if newData is not block start aligned
    let startSlice = Buffer.alloc(0)
    if (!isBlockStartAligned) {
      startSlice = originalBlock.slice(0, writeOffset)
    }

    // Any data reamining after new block
    const endSlice = originalBlock.slice(writeOffset + newData.length)

    // Patch up slices to create new block
    const newBlock = Buffer.concat([startSlice, newData, endSlice])

    return newBlock
  }

	/**
	 * Gets the byte offset from the beginning of the block that position lies within
	 * @param position: number. Position.
	 * @returns number. Boundary offset
	 */
  private getBoundaryOffset(position: number) {
    // Position can start from 0 but block size starts counting from 1
    // Compare apples to apples first and then subtract 1
    return ((position + 1) % this.blockSize) - 1
  }

	/**
	 * Checks if path is a file descriptor (number) or not (string).
	 * @param path Path of file.
	 * @returns boolean
	 */
  private isFileDescriptor(path: fs.PathLike | number): path is number {
    if (typeof path === 'number') {
      if (this.fileDescriptors.has(path)) {
        return true
      }
    }

    return false
  }

	/**
	 * Retrieves the upperFd from an efs fd index.
	 * @param fdIndex File descriptor.
	 * @returns number
	 */
  private getUpperFd(fdIndex: number): number {
    if (this.fileDescriptors.has(fdIndex)) {
      const efsFd = this.fileDescriptors.get(fdIndex)
      if (efsFd) {
        const upperFd = efsFd.getUpperFd()
        if (upperFd !== undefined || upperFd !== null) {
          return upperFd
        } else {
          throw Error("efs file descriptor is undefined")
        }
      } else {
        throw Error("efs file descriptor is undefined")
      }
    } else {
      throw Error("efs file descriptor does not exist")
    }
  }

	/**
	 * Retrieves the lowerFd from an efs fd index.
	 * @param fdIndex File descriptor.
	 * @returns number
	 */
  private getLowerFd(fdIndex: number): number {
    if (this.fileDescriptors.has(fdIndex)) {
      const efsFd = this.fileDescriptors.get(fdIndex)
      if (efsFd) {
        const lowerFd = efsFd.getLowerFd()
        if (lowerFd !== undefined || lowerFd !== null) {
          return lowerFd
        } else {
          throw Error("efs file descriptor is undefined")
        }
      } else {
        throw Error("efs file descriptor is undefined")
      }
    } else {
      throw Error("efs file descriptor does not exist")
    }
  }

	/**
	 * Takes a position in a file and returns the block number that 'position' lies in.
	 * @param position
	 * @returns number (Block number)
	 */
  private offsetToBlockNum(position: number): number {
    // we use blockSize as opposed to chunkSize because chunk contains metadata
    // transparent to user. When user specifies position it is as if it were plaintext
    return Math.floor(position / this.blockSize)
  }

	/**
	 * Calculates the offset/position of the block number in the unencrypted file.
	 * @param blockNum Block number.
	 * @returns number (position offset)
	 */
  private blockNumToOffset(blockNum: number): number {
    return (blockNum * this.blockSize)
  }

	/**
	 * Calculates the offset/position of the chunk number in the unencrypted file.
	 * @param chunkNum Chunk number.
	 * @returns number (position offset)
	 */
  private chunkNumToOffset(chunkNum: number): number {
    return (chunkNum * this.chunkSize)
  }

	/**
	 * Creates a block generator for block iteration, split is per block length.
	 * @param blocks Buffer containing blocks to be split.
	 * @param blockSize Size of an individual block.
	 * @returns IterableIterator<Buffer> (the iterator for the blocks split into buffer.length/blockSize blocks)
	 */
  private *blockGenerator(blocks: Buffer, blockSize: number = this.blockSize): IterableIterator<Buffer> {
    let iterCount = 0
    let currOffset = 0
    while (currOffset < blocks.length) {
      yield blocks.slice(currOffset, currOffset + blockSize)
      currOffset += blockSize
      iterCount++
    }
  }

	/**
	 * Creates a chunk generator for chunk iteration, split is per block length.
	 * @param chunks Buffer containing blocks to be split.
	 * @param chunkSize Size of an individual block.
	 * @returns IterableIterator<Buffer> (the iterator for the chunks split into buffer.length/chunkSize blocks)
	 */
  private *chunkGenerator(chunks: Buffer, chunkSize: number = this.chunkSize): IterableIterator<Buffer> {
    let iterCount = 0
    let currOffset = 0
    while (currOffset < chunks.length) {
      yield chunks.slice(currOffset, currOffset + chunkSize)
      currOffset += chunkSize
      iterCount++
    }
  }

	/**
	 * Checks if the position is out of bounds for a given file (fd).
	 * @param fd File descriptor.
	 * @param position Position in question.
	 * @returns boolean (true if position is out of bounds, false if position is within bounds)
	 */
  private positionOutOfBounds(fd: number, position: number): boolean {
    // TODO: confirm that '>=' is correct here
    const isPositionOutOfBounds = (position >= this.lowerDir.fstatSync(fd).size)
    return isPositionOutOfBounds
  }

	/**
	 * Synchronously checks if file (fd) contains conntent or not.
	 * @param fd File descriptor.
	 * @returns boolean (true if file has content, false if file has no content)
	 */
  private hasContentSync(fd: number): boolean {
    const hasContent = (this.lowerDir.fstatSync(fd).size !== 0)
    return hasContent
  }

	/**
	 * Synchronously checks for file size.
	 * @param fd File descriptor.
	 * @returns boolean (true if file has content, false if file has no content)
	 */
  private getPostWriteFileSize(fd: number, position: number, length: number): number {
    const fileMeta = this.metadata[fd]
    const newSize = position + length
    const fileSize = fileMeta.size
    if (newSize > fileSize) {
      fileMeta.size = newSize
      return newSize
    } else {
      return fileSize
    }
  }

  private writeMetadataSync(fd: number): void {
    const metadata = this.getMetadata(fd)
    const serialMeta = JSON.stringify(metadata)
    const metadataBockBuffer = Buffer.concat(
      [Buffer.from(serialMeta)],
      this.blockSize,
    )
    const metadataChunkBuffer = this.crypto.encryptBlockSync(metadataBockBuffer)
    const metadataOffset = this.getMetadataOffsetSync(fd)
    this.lowerDir.writeSync(
      this.getLowerFd(fd),
      metadataChunkBuffer,
      0,
      metadataChunkBuffer.length,
      metadataOffset,
    )
  }

  private async loadMetadata(fd: number): Promise<void> {
    const metaChunk = Buffer.alloc(this.chunkSize)
    const metaChunkOffset = this.getMetadataOffsetSync(fd)

    await promisify(this.lowerDir.read)(
      this.getLowerFd(fd),
      metaChunk,
      0,
      metaChunk.length,
      metaChunkOffset,
    )

    const metaBlock = await this.crypto.decryptChunk(metaChunk)
    const metaPlainTrimmed = metaBlock.slice(0, (metaBlock.indexOf('\0')))

    const fileMeta = eval("(" + metaPlainTrimmed.toString() + ")")
    this.metadata[fd] = fileMeta
  }

  private loadMetadataSync(fd: number): void {
    const metaChunk = Buffer.alloc(this.chunkSize)
    const metaChunkOffset = this.getMetadataOffsetSync(fd)

    this.lowerDir.readSync(
      this.getLowerFd(fd),
      metaChunk,
      0,
      metaChunk.length,
      metaChunkOffset,
    )

    const metaBlock = this.crypto.decryptChunkSync(metaChunk)
    const metaPlainTrimmed = metaBlock.slice(0, (metaBlock.indexOf('\0')))

    const fileMeta = eval("(" + metaPlainTrimmed.toString() + ")")
    this.metadata[fd] = fileMeta
  }

  private getMetadata(fd: number): UpperDirectoryMetadata {
    if (this.metadata.hasOwnProperty(fd)) {
      const fileMeta = this.metadata[fd]
      if (fileMeta) {
        return fileMeta
      }
    }
    throw Error("file descriptor has no metadata stored")
  }
  private getMetaField(fd: number, fieldName: 'size' | 'keyHash'): number | Buffer {
    const fileMeta: UpperDirectoryMetadata = this.getMetadata(fd)
    if (fileMeta.hasOwnProperty(fieldName)) {
      const fieldVal = fileMeta[fieldName]
      if (fieldVal != null) {
        return fieldVal
      }
    }
    throw Error("Field does not exist")
  }
  private getMetadataOffsetSync(fd: number): number {
    const efsFd = this.getEfsFd(fd)
    const stats = this.lowerDir.fstatSync(this.getLowerFd(fd))
    const size = stats.size
    if (efsFd.getFlags()[0] === "w") {
      return size
    }

    const numBlocks = size / this.chunkSize
    return this.chunkNumToOffset(numBlocks - 1)
  }
  private getEfsFd(fd: number): FileDescriptor {
    if (this.fileDescriptors.has(fd)) {
      const efsFd = this.fileDescriptors.get(fd)
      if (efsFd) {
        return efsFd
      }
    }

    throw Error("file descriptor has no metadata stored")
  }


	/**
	 * Processes path types and collapses it to a string.
	 * The path types can be string or Buffer or URL.
	 * @private
	 */
  private getPath(path: fs.PathLike): string {
    if (typeof path === 'string') {
      return path
    }
    if (path instanceof Buffer) {
      return path.toString()
    }
    if (path instanceof URL) {
      return this.getPathFromURL(path)
    }
    throw new TypeError('path must be a string or Buffer or URL')
  }

	/**
	 * Acquires the file path from an URL object.
	 * @private
	 */
  private getPathFromURL(url: { pathname: string } | URL): string {
    if (url.hasOwnProperty('hostname')) {
      throw new TypeError('ERR_INVALID_FILE_URL_HOST')
    }
    const pathname = url.pathname
    if (pathname.match(/%2[fF]/)) {
      // must not allow encoded slashes
      throw new TypeError('ERR_INVALID_FILE_URL_PATH')
    }
    return decodeURIComponent(pathname)
  }
}


