import fs from 'fs'
import Crypto from './Crypto'
import FileDescriptor from './FileDescriptor'
import Path from 'path'
import { constants, DEFAULT_FILE_PERM } from './constants'
import { EncryptedFSError, errno } from './EncryptedFSError'
import { optionsStream, ReadStream, WriteStream } from './Streams'
import { promisify } from 'util'
import { Buffer } from 'buffer/'
import autoBind from 'auto-bind-proxy'

/* TODO: we need to maintain seperate permission for the lower directory vs the upper director
 * For example: if you open a file as write-only, how will you merge the block on the ct file?
 * First you need to read, overlay, then write. But we can read, since the file is write-only.
 * So the lower dir file always needs to be read-write, the upper dir file permission will be
 * whatever the user specified.
 *
 * One way to implement this is through inheriting the FileDeescriptors class.
 * Extend the class by adding another attribute for the
 */

type Metadata = {
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
  // TODO: need to have per file cryptor instance
  private uid: number
  private gid: number
  private umask: number
  private upperDir: any
  private upperDirContextControl: any
  private lowerDir: typeof fs
  private lowerDirContextControl: typeof process
  private crypto: Crypto
  private initVectorSize: number
  private blockSize: number
  private chunkSize: number
  private fileDescriptors: Map<number, FileDescriptor>
  private key: Buffer | string
  private keySize: number = 32
  private headerSize: number
  private metadata: { [fd: number]: Metadata }
  private useWebWorkers: boolean
  constants: any
  constructor(
    key: Buffer | string,
    upperDir: typeof fs,
    upperDirContextControl: typeof fs,
    lowerDir: typeof fs,
    lowerDirContextControl: typeof process,
    umask = 0o022,
    initVectorSize = 16,
    blockSize = 4096,
    useWebWorkers = false
  ) {
    this.umask = umask
    this.key = key
    this.crypto = new Crypto(key, undefined, undefined, useWebWorkers)
    this.upperDir = autoBind(upperDir)
    this.upperDirContextControl = autoBind(upperDirContextControl)
    this.lowerDir = lowerDir
    this.lowerDirContextControl = lowerDirContextControl
    this.initVectorSize = initVectorSize
    this.blockSize = blockSize
    this.chunkSize = this.blockSize + this.initVectorSize
    this.fileDescriptors = new Map()
    this.headerSize = this.blockSize
    this.metadata = {}
    this.useWebWorkers = useWebWorkers
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
    options: fs.WriteFileOptions | undefined = undefined
  ): Promise<Buffer> {
    let fd: number | undefined = undefined
    options = this.getFileOptions(
      { encoding: null, mode: 0o666, flag: "a" },
      options,
    )
    try {
      if (typeof path === 'number') {
        fd = <number>path
      } else {
        fd = this.openSync(path, "r")
      }
      const size = this.getMetadata(fd).size
      const readBuf = Buffer.allocUnsafe(size)
      const bytesRead = this.readSync(fd, readBuf, 0, size, 0)
      return readBuf
    } catch (err) {
      throw(err)
    } finally {
      if (fd !== undefined) this.closeSync(fd)
    }
  }

	/**
	 * Synchronously reads data from a file given the path of that file.
	 * @param path string. Path to file.
	 * @returns Buffer (read buffer).
	 */
  readFileSync(
    path: fs.PathLike | number,
    options: fs.WriteFileOptions
  ): string | Buffer {
    let fd: number | undefined = undefined
    options = this.getFileOptions(
      { encoding: null, mode: 0o666, flag: "a" },
      options,
    )
    try {
      if (typeof path === 'number') {
        fd = <number>path
      } else {
        fd = this.openSync(path, "r")
      }
      // Check if file descriptor points to directory
      if (this.fstatSync(fd).isDirectory()) {
        throw (new EncryptedFSError(errno.EISDIR, null, null, 'read'))
      }
      const size = this.getMetadata(fd).size
      const readBuffer = Buffer.allocUnsafe(size)
      this.readSync(fd, readBuffer, 0, size, 0)
      return (options && options.encoding) ? readBuffer.toString(options.encoding) : readBuffer
    } finally {
      if (fd !== undefined) this.closeSync(fd)
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
    length: number = Infinity,
    position: number = 0
  ): Promise<number> {
    if (typeof position === 'number' && position < 0) {
      throw new EncryptedFSError(errno.EINVAL, null, null, 'read');
    }
    if  (length === Infinity) {
      length = buffer.length
    }
    try {
      const startChunkNum = this.offsetToBlockNum(position)
      let chunkCtr = 0
      const lowerFd = this.getLowerFd(fd)
      const metadata = this.getMetadata(fd)
      if (position + length > metadata.size) {
        length = metadata.size - position
      }
      let bytesRead = 0
      let targetStart = offset
      const numChunksToRead = Math.ceil(length / this.blockSize)
      for (const chunkNum = startChunkNum; chunkCtr < numChunksToRead; chunkCtr++) {
        const chunkOffset = this.chunkNumToOffset(chunkNum + chunkCtr)
        const chunkBuf = Buffer.allocUnsafe(this.chunkSize)

        await promisify(this.lowerDir.read)(lowerFd, chunkBuf, 0, this.chunkSize, chunkOffset)
        // extract the iv from beginning of chunk
        const iv = chunkBuf.slice(0, this.initVectorSize)
        // extract remaining data which is the cipher text
        const chunkData = chunkBuf.slice(this.initVectorSize)
        const plainBuf = this.crypto.decryptSync(chunkData, iv)
        const blockBytesRead = plainBuf.copy(buffer, targetStart, 0, plainBuf.length)
        bytesRead += blockBytesRead
        targetStart += blockBytesRead
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
    length: number = Infinity,
    position: number = 0,
  ): number {
    if (typeof position === 'number' && position < 0) {
      throw new EncryptedFSError(errno.EINVAL, null, null, 'read');
    }
    // Check if file descriptor points to directory
    if (this.fstatSync(fd).isDirectory()) {
      throw (new EncryptedFSError(errno.EISDIR, null, null, 'read'))
    }


    if  (length === Infinity) {
      length = buffer.length
    }


    // TODO: actually use offset, length and position

    // length is specified for plaintext file, but we will be reading from encrypted file
    // hence the inclusion of 'chunks' in variable name
    // 1. find out block number the read offset it at
    // 2. blocknum == chunknum so read entire chunk and get iv
    // 3. decrypt chunk with attaned iv.
    //
    // TODO: maybe actually better to call is a chunk
    const startChunkNum = this.offsetToBlockNum(position)
    let chunkCtr = 0
    const plaintextBlocks: Buffer[] = []
    const lowerFd = this.getLowerFd(fd)
    const metadata = this.getMetadata(fd)
    if (position + length > metadata.size) {
      length = metadata.size - position
    }

    const numChunksToRead = Math.ceil(length / this.blockSize)

    for (const chunkNum = startChunkNum; chunkCtr < numChunksToRead; chunkCtr++) {
      const chunkOffset = this.chunkNumToOffset(chunkNum + chunkCtr)
      let chunkBuf = Buffer.alloc(this.chunkSize)

      this.lowerDir.readSync(lowerFd, chunkBuf, 0, this.chunkSize, chunkOffset)

      // extract the iv from beginning of chunk
      const iv = chunkBuf.slice(0, this.initVectorSize)
      // extract remaining data which is the cipher text
      const chunkData = chunkBuf.slice(this.initVectorSize)
      const ptBlock = this.crypto.decryptSync(chunkData, iv)
      plaintextBlocks.push(ptBlock)
    }
    const decryptedReadBuffer = Buffer.concat(
      plaintextBlocks,
      numChunksToRead * this.blockSize,
    )

    // offset into the decryptedReadBuffer to read from
    const startBlockOffset = position & this.blockSize - 1

    decryptedReadBuffer.copy(buffer, offset, startBlockOffset, length)

		/*

		// TODO: we never use buffer from param
		// read entire chunk 'position' belongs to
		let chunkBuf = Buffer.alloc(this._chunkSize)
		// remember every chunk_i is associated with block_i, for integer i
		// i.e. startChunkNum and chunkNum can be used interchangably
		const startChunkOffset = startChunkNum * this._chunkSize
		fs.readSync(fd, chunkBuf, 0, this._chunkSize, startChunkOffset)

		// TODO: is this the most efficient way? Can we make do without the copy?
		ptBlock.copy(buffer, offset, position, length)
		*/

		/* TODO: this is not an accurate measure of bytesRead.
		 : find out in what cases bytesRead will be less than read
		 : one case is when you read more than the file contains
		 : in this case we may need a special eof marker or some meta
		 : data about the plain text
		 */
    return length
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
    data: Buffer | string,
    offset: number | undefined = undefined,
    length: number | undefined = undefined,
    position: number | undefined = undefined
  ): Promise<number> {
    try {
      // Define defaults
      const buffer = (typeof data === 'string') ? Buffer.from(data) : data
      offset = offset !== undefined ? offset : 0
      length = length !== undefined ? length : buffer.length
      position = position !== undefined ? position : 0

      const lowerFd = this.getLowerFd(fd)

      // Get block boundary conditions
      const boundaryOffset = position & this.blockSize - 1 // how far from a block boundary our write is
      const numBlocksToWrite = Math.ceil((length + boundaryOffset) / this.blockSize)
      const startBlockNum = this.offsetToBlockNum(position)
      const endBlockNum = startBlockNum + numBlocksToWrite - 1
      // Get overlay conditions
      const startBlockOverlaySize = this.blockSize - boundaryOffset
      // TODO: this should not be using the offsets. That pertains to the file, not this buffer.
      const startBlockOverlay = buffer.slice(offset, startBlockOverlaySize)
      let startBlock = this.overlaySegment(fd, startBlockOverlay, position)
      let middleBlocks = Buffer.allocUnsafe(0)
      let endBlock = Buffer.allocUnsafe(0)
      // only bother if there is a last chunk
      let endBlockBufferOffset: number = 0
      if (numBlocksToWrite >= 2) {
        endBlockBufferOffset = startBlockOverlaySize + (numBlocksToWrite - 2) * this.blockSize
        const endBlockOverlay = buffer.slice(offset + endBlockBufferOffset)

        const endBlockOffset = this.blockNumToOffset(endBlockNum)

        endBlock = this.overlaySegment(fd, endBlockOverlay, endBlockOffset)
      }
      // slice out middle blocks if they actually exist
      if (numBlocksToWrite >= 3) {
        middleBlocks = buffer.slice(startBlockOverlaySize, endBlockBufferOffset)
      }

      // Assert newBlocks is a multiple of blocksize

      const newBlocks = Buffer.concat([startBlock, middleBlocks, endBlock])
      if (newBlocks.length % this.blockSize != 0) {
        throw(new EncryptedFSError(errno.EINVAL, null, null, 'write'))
      }

      // Write to upper directory (unencrypted)
      this.upperDir.writeSync(
        fd,
        newBlocks,
        0,
        newBlocks.length,
        this.blockNumToOffset(startBlockNum)
      )

      // Write to lower directory (encrypted)
      const blockIter = this.blockGenerator(newBlocks)
      const encryptedChunks: Buffer[] = []
      for (let block of blockIter) {
        const iv = this.crypto.getRandomInitVectorSync()
        const ctBlock = this.crypto.encryptSync(block, iv)

        const chunk = Buffer.concat([iv, ctBlock], this.chunkSize)
        encryptedChunks.push(chunk)
      }
      const encryptedWriteBuffer = Buffer.concat(
        encryptedChunks,
        numBlocksToWrite * this.chunkSize,
      )
      const lowerWritePos = this.chunkNumToOffset(startBlockNum)

      await promisify(this.lowerDir.write)(
        lowerFd,
        encryptedWriteBuffer,
        0,
        encryptedWriteBuffer.length,
        lowerWritePos
      )

      const newFileSize = position! + length!
      if (newFileSize > this.getMetadata(fd).size) {
        this.getMetadata(fd).size = newFileSize
        this.writeMetadataSync(fd)
      }

      return length
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
    data: Buffer | string,
    offset?: number,
    length?: number,
    position?: number
  ): number {
    // Define defaults
    const buffer = (typeof data === 'string') ? Buffer.from(data) : data
    offset = offset !== undefined ? offset : 0
    length = length !== undefined ? length : buffer.length
    position = position !== undefined ? position : 0

    const lowerFd = this.getLowerFd(fd)
    // Get block boundary conditions
    const boundaryOffset = position & this.blockSize - 1 // how far from a block boundary our write is
    const numBlocksToWrite = Math.ceil((length + boundaryOffset) / this.blockSize)
    const startBlockNum = this.offsetToBlockNum(position)
    const endBlockNum = startBlockNum + numBlocksToWrite - 1
    // Get overlay conditions
    const startBlockOverlaySize = this.blockSize - boundaryOffset
    // TODO: this should not be using the offsets. That pertains to the file, not this buffer.
    const startBlockOverlay = buffer.slice(offset, startBlockOverlaySize)
    let startBlock = this.overlaySegment(fd, startBlockOverlay, position)
    let middleBlocks = Buffer.allocUnsafe(0)
    let endBlock = Buffer.allocUnsafe(0)
    // only bother if there is a last chunk
    let endBlockBufferOffset: number = 0
    if (numBlocksToWrite >= 2) {
      endBlockBufferOffset = startBlockOverlaySize + (numBlocksToWrite - 2) * this.blockSize
      const endBlockOverlay = buffer.slice(offset + endBlockBufferOffset)

      const endBlockOffset = this.blockNumToOffset(endBlockNum)

      endBlock = this.overlaySegment(fd, endBlockOverlay, endBlockOffset)
    }
    // slice out middle blocks if they actually exist
    if (numBlocksToWrite >= 3) {
      middleBlocks = buffer.slice(startBlockOverlaySize, endBlockBufferOffset)
    }

    // TODO: assert newBlocks is a multiple of blocksize
    const newBlocks = Buffer.concat([startBlock, middleBlocks, endBlock])
    this.upperDir.writeSync(
      fd,
      newBlocks,
      0,
      newBlocks.length,
      this.blockNumToOffset(startBlockNum),
    )
    const blockIter = this.blockGenerator(newBlocks)
    const encryptedChunks: Buffer[] = []
    for (let block of blockIter) {
      const iv = this.crypto.getRandomInitVectorSync()
      const ctBlock = this.crypto.encryptSync(block, iv)

      const chunk = Buffer.concat([iv, ctBlock], this.chunkSize)
      encryptedChunks.push(chunk)
    }
    const encryptedWriteBuffer = Buffer.concat(
      encryptedChunks,
      numBlocksToWrite * this.chunkSize,
    )
    const lowerWritePos = this.chunkNumToOffset(startBlockNum)

    this.lowerDir.writeSync(
      lowerFd,
      encryptedWriteBuffer,
      0,
      encryptedWriteBuffer.length,
      lowerWritePos,
    )
    const newFileSize = position + length
    if (newFileSize > this.getMetadata(fd).size) {
      this.getMetadata(fd).size = newFileSize
      this.writeMetadataSync(fd)
    }

    return length
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
    options: fs.WriteFileOptions
  ): Promise<void> {
    let fd: number
    try {
      // Get file descriptor
      if (typeof file === 'number') {
        fd = file
      } else {
        fd = await this.open(file, )
      }
      options = this.getFileOptions(
        { encoding: "utf8", mode: 0o666, flag: "a" },
        options,
      )
      if (!options.flag || this.isFileDescriptor(file)) {
        options.flag = "a"
      }

      await promisify(this.lowerDir.appendFile)(file, data, options)
    } catch (err) {
      throw(err)
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
    path: fs.PathLike,
    data: Buffer | string,
    options: fs.WriteFileOptions
  ): void {
    if (typeof options === 'object') {
      options = this.getFileOptions(
        { encoding: "utf8", mode: 0o666, flag: "a" },
        options,
      )
    } else {
      options = this.getFileOptions(
        { encoding: "utf8", mode: 0o666, flag: "a" },
      )
    }
    if (!options.flag || this.isFileDescriptor(path)) {
      options.flag = "a"
    }

    this.lowerDir.appendFileSync(path, data, options)
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
    data: Buffer | string,
    options: fs.WriteFileOptions | undefined = undefined
  ): Promise<void> {
    try {
      options = this.getFileOptions(
        { encoding: "utf8", mode: 0o666, flag: "w" },
        options,
      )
      const flag = options.flag || "w"
      const isUserFileDescriptor = this.isFileDescriptor(path)
      if (isUserFileDescriptor) {
        const fd = <number>path
        let offset = 0
        if (typeof data === 'string') {
          data = Buffer.from(data)
        }
        let length = data.byteLength

        let position = 0

        while (length > 0) {
          const written = this.writeSync(fd, data, offset, length, position)
          offset += written
          length -= written
          if (position !== null) {
            position += written
          }
        }
      } else if (typeof path === 'string') {
        let fd: number
        try {
          fd = await this.open(path, flag, <number>options.mode)
        } catch (err) {
          throw(err)
        }
        if (typeof data === 'string') {
          data = Buffer.from(data)
        }
        const dataBuffer = (typeof data === 'string') ? Buffer.from(data) : data
        // const position = /a/.test(flag) ? null : 0
        let position = 0
        let offset = 0
        while (length > 0) {
          const written = await this.write(fd, data, offset, length, position)
          offset += written
          length -= written
          if (position !== null) {
            position += written
          }
        }
      } else {
        throw new EncryptedFSError(errno.EBADF, null, null, 'write')
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
      options = this.getFileOptions(
        { encoding: "utf8", mode: 0o666, flag: "w" },
        options,
      )
      const flag = options.flag || "w"
      const isUserFileDescriptor = this.isFileDescriptor(path)
      let fd: number
      if (isUserFileDescriptor) {
        fd = <number>path
      } else if (typeof path === 'string') {
        fd = this.openSync(path, flag, <number>options.mode)
      } else {
        throw new EncryptedFSError(errno.EBADF, null, null, 'write')
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
    flags: string | undefined = undefined,
    mode: number | undefined = undefined
  ): Promise<number> {
    try {
      flags = (flags !== undefined) ? flags : 'r'
      mode = (mode !== undefined) ? mode : 0o666
      // const lowerFlags = flags[0] === "w" ? "w+" : "r+"
      const lowerFlags = flags
      const _path = this.getPath(path)
      const dirPath = Path.dirname(_path)
      // Open on upperDir
      const lowerFd = await promisify(this.lowerDir.open)(path, lowerFlags, mode)
      const upperFilePath = Path.resolve(_path)
      if (flags![0] === "r" && !this.upperDir.existsSync(upperFilePath)) {
        this.upperDir.closeSync(this.upperDir.openSync(upperFilePath, "w"))
      }
      // Open on lowerDir
      const upperFd = await promisify(this.upperDir.open)(upperFilePath, flags!, mode)
      // Create efsFd
      const efsFd = new FileDescriptor(lowerFd, upperFd, flags!)
      this.fileDescriptors.set(upperFd, efsFd)

      if (flags![0] === "r") {
        this.loadMetadata(upperFd)
      } else if (flags![0] === "w") {
        const hash = Buffer.from(this.crypto.hashSync(this.key))
        this.metadata[upperFd] = { keyHash: hash, size: 0 }
        this.writeMetadataSync(upperFd)
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
    flags: string = "r",
    mode: number = 0o666
  ): number {
    try {
      const pathString: string = (typeof path === 'string') ? path : ((path.constructor === Buffer) ? path.toString() : this.getPathFromURL(path as URL))
      // TODO: why do we add write flag to lower flags?
      // const lowerFlags = flags[0] === "w" ? "w+" : "r+"
      const lowerFlags = flags
      const lowerFd = this.lowerDir.openSync(pathString, lowerFlags, mode)
      const dirPath = Path.dirname(pathString)
      const upperFilePath = Path.resolve(pathString)
      if (flags[0] === "r" && !this.upperDir.existsSync(upperFilePath)) {
        this.upperDir.closeSync(this.upperDir.openSync(upperFilePath, "w"))
      }
      const upperFd = this.upperDir.openSync(upperFilePath, flags, mode)
      const efsFd = new FileDescriptor(lowerFd, upperFd, flags)
      this.fileDescriptors.set(upperFd, efsFd)

      // Check if file descriptor is directory
      const isFile = this.fstatSync(upperFd)?.isFile()
      // If file descriptor points to file, write metadata
      if (isFile) {
        if (flags[0] === "r") {
          this.loadMetadata(upperFd)
        } else if (flags[0] === "w") {
          const hash = this.crypto.hashSync(this.key)
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
    return this.key
  }

  private getFileOptions(defaultOptions: Object, options?: fs.WriteFileOptions): Object {
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
	 * Reads the whole block that the position lies within.
	 * @param fd File descriptor.
	 * @param position Position of data required.
	 * @returns Buffer.
	 */
  private readBlock(fd: number, position: number): Buffer {
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

  // #TODO: optimise to skip read if newData is block size, otherwise always need a read
  // TODO: what happens if file is less than block size?
	/**
	 * Reads from disk the chunk containing the block that needs to be merged with new block
	 * @param fd File descriptor.
	 * @param newData Buffer containing the new data.
	 * @param position Position of the insertion.
	 * @returns Buffer (a plaintext buffer containing the merge blocks in a single block).
	 */
  private overlaySegment(fd: number, newData: Buffer, position: number) {
    // 	case 1:  segment is aligned to start of block
    // 	case 2:  segment is aligned to start-of-block but end before end-of-block
    // 	case 3:  segment is not aligned to start and ends before end-of-block
    // 	case 4:  segment is not aligned to start-of-block and ends at end-of-block
    //
    // 	Cases 3 and 4 are not possible when overlaying the last segment
    //
    // TODO: throw err if buff length  > block size


    const writeOffset = position & (this.blockSize - 1) // byte offset from where to start writing new data in the block

    // read entire block, position belongs to
    const origBlock = this.readBlock(fd, position)

    let startSlice = Buffer.alloc(0)
    // Populate array if newData is not block aligned
    const isBlockAligned = ((position & this.blockSize - 1) === 0)
    if (!isBlockAligned) {
      startSlice = origBlock.slice(0, writeOffset)
    }

    // Any data reamining after new block
    const endSlice = origBlock.slice(writeOffset + newData.length)

    // patch up slices to create new block
    // TODO: specify length -- maybe also assert the 3 segments do infact amount to only blocksize
    const newBlock = Buffer.concat([startSlice, newData, endSlice])


    // TODO: assert that newBlock is === blockSize

    return newBlock
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
	 * Calculates the offset/position of the chunk number in the unencrypted file.
	 * @param chunkNum Chunk number.
	 * @returns number (position offset)
	 */
  private offsetToChunkNum(position: number) {
    return Math.floor(position / this.chunkSize)
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
    const iv = this.crypto.getRandomInitVectorSync()
    const metadata = this.getMetadata(fd)
    const serialMeta = JSON.stringify(metadata)
    const metadataBlk = Buffer.concat(
      [Buffer.from(serialMeta)],
      this.blockSize,
    )
    const ctMetadata = this.crypto.encryptSync(metadataBlk, iv)
    const metaChunk = Buffer.concat([iv, ctMetadata], this.chunkSize)
    const metadataOffset = this.getMetadataOffsetSync(fd)
    this.lowerDir.writeSync(
      this.getLowerFd(fd),
      metaChunk,
      0,
      metaChunk.length,
      metadataOffset,
    )
  }

  private loadMetadata(fd: number): void {
    const metaChunk = Buffer.allocUnsafe(this.chunkSize)
    const metaChunkOffset = this.getMetadataOffsetSync(fd)
    fd
    this.lowerDir.readSync(
      this.getLowerFd(fd),
      metaChunk,
      0,
      metaChunk.length,
      metaChunkOffset,
    )
    const iv = metaChunk.slice(0, this.initVectorSize)

    const metaCt = metaChunk.slice(this.initVectorSize)
    const metaPlain = this.crypto.decryptSync(metaCt, iv)
    const metaPlainTrimmed = metaPlain.slice(0, (metaPlain.indexOf('\0')))

    const fileMeta = eval("(" + metaPlainTrimmed.toString() + ")")
    this.metadata[fd] = fileMeta
  }

  private getMetadata(fd: number): Metadata {
    if (this.metadata.hasOwnProperty(fd)) {
      const fileMeta = this.metadata[fd]
      if (fileMeta) {
        return fileMeta
      }
    }
    throw Error("file descriptor has no metadata stored")
  }
  private getMetaField(fd: number, fieldName: 'size' | 'keyHash'): number | Buffer {
    const fileMeta: Metadata = this.getMetadata(fd)
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


