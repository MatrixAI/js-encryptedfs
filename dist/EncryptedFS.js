"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const auto_bind_proxy_1 = __importDefault(require("auto-bind-proxy"));
const FileDescriptor_1 = __importDefault(require("./FileDescriptor"));
const constants_1 = require("./constants");
const EncryptedFSError_1 = require("./EncryptedFSError");
const util_2 = require("./util");
const Streams_1 = require("./Streams");
const EncryptedFSCrypto_1 = require("./EncryptedFSCrypto");
/**
 * Encrypted filesystem written in TypeScript for Node.js.
 * @param key A key.
 * @param upperDir The upper directory file system.
 * @param lowerDir The lower directory file system.
 * @param initVectorSize The size of the initial vector, defaults to 16.
 * @param blockSize The size of block, defaults to 4096.
 * @param useWebWorkers Use webworkers to make crypto tasks true async, defaults to false.
 */
class EncryptedFS {
    constructor(key, upperDir, upperDirContextControl, lowerDir, lowerDirContextControl, umask = 0o022, blockSize = 4096, useWebWorkers = false, cryptoLib = undefined, workerPool) {
        this.promises = {
            /**
             * Asynchronously tests a user's permissions for the file specified by path.
             * @param fd number. File descriptor.
             * @returns Promise<void>.
             */
            access: this.accessAsync.bind(this),
            /**
             * Asynchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
             * @param path string. Path to create.
             * @returns void.
             */
            lstat: this.lstatAsync.bind(this),
            /**
             * Asynchronously makes the directory in the upper file system directory. Propagates upper fs method.
             * @param path string. Path to create.
             * @param mode number | undefined. Permissions or mode.
             * @returns void.
             */
            mkdir: this.mkdirAsync.bind(this),
            /**
             * Asynchronously makes a temporary directory with the prefix given.
             * @param prefix string. Prefix of temporary directory.
             * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
             * @returns void.
             */
            mkdtemp: this.mkdtempAsync.bind(this),
            /**
             * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
             * @param path string.
             * @returns void.
             */
            stat: this.statAsync.bind(this),
            /**
             * Asynchronously removes the directory in the upper file system directory. Propagates upper fs method.
             * @param path string. Path to create.
             * @param options: { recursive: boolean }.
             * @returns void.
             */
            rmdir: this.rmdirAsync.bind(this),
            /**
             * Asynchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
             * @param target string. Destination path.
             * @param path string. Source path.
             * @returns void.
             */
            symlink: this.symlinkAsync.bind(this),
            /**
             * Asynchronously changes the size of the file by len bytes.
             * @param dstPath string. Destination path.
             * @param srcPath string. Source path.
             * @returns void.
             */
            truncate: this.truncateAsync.bind(this),
            /**
             * Asynchronously unlinks the given path in the upper and lower file system directories.
             * @param path string. Path to create.
             * @returns void.
             */
            unlink: this.unlinkAsync.bind(this),
            /**
             * Asynchronously changes the access and modification times of the file referenced by path.
             * @param path string. Path to file.
             * @param atime number | string | Date. Access time.
             * @param mtime number | string | Date. Modification time.
             * @returns void.
             */
            utimes: this.utimesAsync.bind(this),
            /**
             * Asynchronously closes the file descriptor.
             * @param fd number. File descriptor.
             * @returns Promise<void>.
             */
            close: this.closeAsync.bind(this),
            /**
             * Asynchronously writes buffer (with length) to the file descriptor at an offset and position.
             * @param path string. Path to directory to be read.
             * @param options FileOptions.
             * @returns string[] (directory contents).
             */
            readdir: this.readdirAsync.bind(this),
            /**
             * Asynchronously checks if path exists.
             * @param path string.
             * @returns boolean.
             */
            exists: this.existsAsync.bind(this),
            /**
             * Asynchronously manipulates the allocated disk space for a file.
             * @param fdIndex number. File descriptor index.
             * @param offset number. Offset to start manipulations from.
             * @param len number. New length for the file.
             * @returns void.
             */
            fallocate: this.fallocateAsync.bind(this),
            /**
             * Asynchronously changes the permissions of the file referred to by fdIndex.
             * @param fdIndex number. File descriptor index.
             * @param mode number. New permissions set.
             * @returns void.
             */
            fchmod: this.fchmodAsync.bind(this),
            /**
             * Asynchronously changes the owner or group of the file referred to by fdIndex.
             * @param fdIndex number. File descriptor index.
             * @param uid number. User identifier.
             * @param gid number. Group identifier.
             * @returns void.
             */
            fchown: this.fchownAsync.bind(this),
            /**
             * Asynchronously flushes in memory data to disk. Not required to update metadata.
             * @param fdIndex number. File descriptor index.
             * @returns void.
             */
            fdatasync: this.fdatasyncAsync.bind(this),
            /**
             * Asynchronously retrieves data about the file described by fdIndex.
             * @param fd number. File descriptor.
             * @returns void.
             */
            fstat: this.fstatAsync.bind(this),
            /**
             * Asynchronously flushes all modified data to disk.
             * @param fdIndex number. File descriptor index.
             * @returns void.
             */
            fsync: this.fsyncAsync.bind(this),
            /**
             * Asynchronously truncates to given length.
             * @param fdIndex number. File descriptor index
             * @param len number. Length to truncate to.
             * @returns void.
             */
            ftruncate: this.ftruncateAsync.bind(this),
            /**
             * Asynchronously changes the access and modification times of the file referenced by fdIndex.
             * @param fdIndex number. File descriptor index
             * @param atime number | string | Date. Access time.
             * @param mtime number | string | Date. Modification time.
             * @returns void.
             */
            futimes: this.futimesAsync.bind(this),
            /**
             * Asynchronously links a path to a new path.
             * @param existingPath string.
             * @param newPath string.
             * @returns void.
             */
            link: this.linkAsync.bind(this),
            /**
             * Asynchronously reads data from a file given the path of that file.
             * @param path string. Path to file.
             * @returns void.
             */
            readFile: this.readFileAsync.bind(this),
            /**
             * Asynchronously reads link of the given the path. Propagated from upper fs.
             * @param path string. Path to file.
             * @param options FileOptions | undefined.
             * @returns Buffer | string.
             */
            readlink: this.readlinkAsync.bind(this),
            /**
             * Asynchronously determines the actual location of path. Propagated from upper fs.
             * @param path string. Path to file.
             * @param options FileOptions | undefined.
             * @returns void.
             */
            realpath: this.realpathAsync.bind(this),
            /**
             * Asynchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
             * @param oldPath string. Old path.
             * @param oldPath string. New path.
             * @returns void.
             */
            rename: this.renameAsync.bind(this),
            /**
             * Asynchronously reads data at an offset, position and length from a file descriptor into a given buffer.
             * @param fd number. File descriptor.
             * @param buffer Buffer. Buffer to be written from.
             * @param offset number. The offset in the buffer at which to start writing.
             * @param length number. The number of bytes to read.
             * @param position number. The offset from the beginning of the file from which data should be read.
             * @returns Promise<number> (bytes read).
             */
            read: this.readAsync.bind(this),
            /**
             * Asynchronously writes buffer (with length) to the file descriptor at an offset and position.
             * @param fd number. File descriptor.
             * @param buffer Buffer. Buffer to be written from.
             * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
             * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
             * @param position number. The offset from the beginning of the file where this data should be written.
             * @returns Promise<number>.
             */
            write: this.writeAsync.bind(this),
            /**
             * Asynchronously append data to a file, creating the file if it does not exist.
             * @param file string | number. Path to the file or directory.
             * @param data string | Buffer. The data to be appended.
             * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
             * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
             * @returns Promise<void>.
             */
            appendFile: this.appendFileAsync.bind(this),
            /**
             * Asynchronously changes the access permissions of the file system object described by path.
             * @param path string. Path to the fs object.
             * @param mode number. New permissions set.
             * @returns void.
             */
            chmod: this.chmodAsync.bind(this),
            /**
             * Asynchronously changes the owner or group of the file system object described by path.
             * @param path string. Path to the fs object.
             * @param uid number. User identifier.
             * @param gid number. Group identifier.
             * @returns void.
             */
            chown: this.chownAsync.bind(this),
            /**
             * Asynchronously writes data to the path specified with some FileOptions.
             * @param path string | number. Path to the file or directory.
             * @param data string | Buffer. The data to be written.
             * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined } | undefined
             * @returns void.
             */
            writeFile: this.writeFileAsync.bind(this),
            /**
             * Asynchronously opens a file or directory and returns the file descriptor.
             * @param path string. Path to the file or directory.
             * @param flags string. Flags for read/write operations. Defaults to 'r'.
             * @param mode number. Read and write permissions. Defaults to 0o666.
             * @returns Promise<number>
             */
            open: this.openAsync.bind(this),
        };
        this.umask = umask;
        // Set key
        if (typeof key === 'string') {
            this.masterKey = Buffer.from(key);
        }
        else {
            this.masterKey = key;
        }
        if (cryptoLib) {
            this.crypto = new EncryptedFSCrypto_1.EncryptedFSCrypto(this.masterKey, cryptoLib, useWebWorkers, workerPool);
        }
        else {
            this.crypto = new EncryptedFSCrypto_1.EncryptedFSCrypto(this.masterKey, require('crypto'), useWebWorkers, workerPool);
        }
        this.upperDir = auto_bind_proxy_1.default(upperDir);
        this.upperDirContextControl = auto_bind_proxy_1.default(upperDirContextControl);
        this.lowerDir = lowerDir;
        this.lowerDirContextControl = lowerDirContextControl;
        this.blockSize = blockSize;
        this.chunkSize =
            this.blockSize + util_2.cryptoConstants.SALT_LEN + util_2.cryptoConstants.INIT_VECTOR_LEN + util_2.cryptoConstants.AUTH_TAG_LEN;
        this.fileDescriptors = new Map();
        this.metadata = {};
        this.constants = constants_1.constants;
    }
    getUmask() {
        return this.umask;
    }
    setUmask(umask) {
        this.upperDirContextControl.setUmask(umask);
        this.lowerDirContextControl.umask(umask);
        this.umask = umask;
    }
    getUid() {
        return this.uid;
    }
    setUid(uid) {
        this.upperDirContextControl.setUid(uid);
        this.lowerDirContextControl.setuid(uid);
        this.uid = uid;
    }
    getGid() {
        return this.gid;
    }
    setGid(gid) {
        this.upperDirContextControl.setGid(gid);
        this.lowerDirContextControl.setgid(gid);
        this.gid = gid;
    }
    getCwd() {
        return this.upperDirContextControl.getCwd();
    }
    // TODO: nodejs fs (i.e. lowerDir) does not have a native method for changing directory and depends on process.chdir(...)
    // which seems a little too much like a global change. We could also just keep track of the cwd in upperDir (vfs) and then
    // every time there is an operation using lowerDir, we just prepend this cwd to the path.
    chdir(path) {
        this.upperDirContextControl.chdir(path);
        this.lowerDirContextControl.chdir(path);
    }
    /**
     * Asynchronously tests a user's permissions for the file specified by path.
     * @param fd File descriptor.
     */
    async accessAsync(path, mode = 0) {
        try {
            await util_1.promisify(this.lowerDir.access)(path, mode);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Tests a user's permissions for the file specified by path.
     * @param fd File descriptor.
     */
    access(path, mode = 0, callback) {
        this.accessAsync(path, mode).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously tests a user's permissions for the file specified by path.
     * @param fd File descriptor.
     */
    accessSync(path, mode = this.constants.F_OK) {
        this.lowerDir.accessSync(path, mode);
    }
    /**
     * Asynchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     */
    async lstatAsync(path) {
        try {
            return await util_1.promisify(this.lowerDir.lstat)(path);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Retrieves the path stats in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     */
    lstat(path, callback) {
        this.lstatAsync(path).then((stats) => {
            if (callback)
                callback(null, stats);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously retrieves the path stats in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     */
    lstatSync(path) {
        return this.lowerDir.lstatSync(path);
    }
    /**
     * Asynchronously makes the directory in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     * @param mode number | undefined. Permissions or mode.
     */
    async mkdirAsync(path, options = { mode: 0o777, recursive: false }) {
        try {
            if (options.recursive) {
                await util_1.promisify(this.upperDir.mkdirp)(path, options.mode);
            }
            else {
                await util_1.promisify(this.upperDir.mkdir)(path, options.mode);
            }
            const _path = await util_1.promisify(this.lowerDir.mkdir)(path, options);
            return _path;
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Makes the directory in the upper file system directory. Propagates upper fs method.
     */
    mkdir(path, options = { mode: 0o777, recursive: false }, callback) {
        this.mkdirAsync(path, options).then((path) => {
            if (callback)
                callback(null, path);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously makes the directory in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     * @param mode number | undefined. Permissions or mode.
     */
    mkdirSync(path, options = { mode: 0o777, recursive: false }) {
        this.lowerDir.mkdirSync(path, options);
        if (options.recursive) {
            this.upperDir.mkdirpSync(path, options.mode);
        }
        else {
            this.upperDir.mkdirSync(path, options.mode);
        }
    }
    /**
     * Asynchronously makes a temporary directory with the prefix given.
     * @param prefix Prefix of temporary directory.
     * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
     */
    async mkdtempAsync(prefix, options = 'utf8') {
        try {
            const _path = await util_1.promisify(this.upperDir.mkdtemp)(prefix, options);
            await util_1.promisify(this.lowerDir.mkdtemp)(prefix, options);
            return _path;
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Makes a temporary directory with the prefix given.
     * @param prefix Prefix of temporary directory.
     * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
     */
    mkdtemp(prefix, options = 'utf8', callback) {
        this.mkdtempAsync(prefix, options).then((path) => {
            if (callback)
                callback(null, path);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously makes a temporary directory with the prefix given.
     * @param prefix Prefix of temporary directory.
     * @param options { encoding: CharacterEncoding } | CharacterEncoding | null | undefined
     */
    mkdtempSync(prefix, options = 'utf8') {
        const lowerPath = this.lowerDir.mkdtempSync(prefix, options);
        const lowerStat = this.lowerDir.statSync(lowerPath);
        this.upperDir.mkdirpSync(lowerPath, lowerStat.mode);
        return lowerPath;
    }
    /**
     * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
     */
    async statAsync(path) {
        try {
            return await util_1.promisify(this.upperDir.stat)(path);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Retrieves  in the upper file system directory. Propagates upper fs method.
     */
    stat(path, callback) {
        this.statAsync(path).then((stats) => {
            if (callback)
                callback(null, stats);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Asynchronously retrieves  in the upper file system directory. Propagates upper fs method.
     */
    statSync(path) {
        return this.upperDir.statSync(path);
    }
    /**
     * Asynchronously removes the directory in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     * @param options: { recursive: boolean }.
     */
    async rmdirAsync(path, options = undefined) {
        var _a;
        try {
            if (!((_a = options === null || options === void 0 ? void 0 : options.recursive) !== null && _a !== void 0 ? _a : false)) {
                await util_1.promisify(this.upperDir.mkdtemp)(path, options);
            }
            await util_1.promisify(this.lowerDir.rmdir)(path, options);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Removes the directory in the upper file system directory. Propagates upper fs method.
     */
    rmdir(path, options = undefined, callback) {
        this.rmdirAsync(path, options).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously removes the directory in the upper file system directory. Propagates upper fs method.
     * @param path Path to create.
     * @param options: { recursive: boolean }.
     */
    rmdirSync(path, options = undefined) {
        // TODO: rmdirSync on VFS doesn't have an option to recusively delete
        try {
            if (!(options === null || options === void 0 ? void 0 : options.recursive)) {
                this.upperDir.rmdirSync(path);
            }
            this.lowerDir.rmdirSync(path, options);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Asynchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
     * @param target Destination path.
     * @param path Source path.
     */
    async symlinkAsync(target, path, type) {
        try {
            this.upperDir.symlinkSync(target, path, type);
            await util_1.promisify(this.lowerDir.symlink)(target, path, type);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
     * @param target Destination path.
     * @param path Source path.
     */
    symlink(target, path, type, callback) {
        this.symlinkAsync(target, path, type).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously creates a symbolic link between the given paths in the upper file system directory. Propagates upper fs method.
     * @param dstPath Destination path.
     * @param srcPath Source path.
     */
    symlinkSync(target, path, type = 'file') {
        this.upperDir.symlinkSync(target, path, type);
        this.lowerDir.symlinkSync(target, path, type);
    }
    /**
     * Asynchronously changes the size of the file by len bytes.
     */
    async truncateAsync(file, len = 0) {
        try {
            this.upperDir.truncateSync(file, len);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Changes the size of the file by len bytes.
     */
    truncate(file, len = 0, callback) {
        this.truncateAsync(file, len).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously changes the size of the file by len bytes.
     */
    truncateSync(file, len = 0) {
        return this.upperDir.truncateSync(file, len);
    }
    /**
     * Asynchronously unlinks the given path in the upper and lower file system directories.
     * @param path Path to create.
     */
    async unlinkAsync(path) {
        try {
            if (this.upperDir.existsSync(path)) {
                this.upperDir.unlinkSync(path);
            }
            await util_1.promisify(this.lowerDir.unlink)(path);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Unlinks the given path in the upper and lower file system directories.
     * @param path Path to create.
     */
    unlink(path, callback) {
        this.unlinkAsync(path).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously unlinks the given path in the upper and lower file system directories.
     * @param path Path to create.
     */
    unlinkSync(path) {
        if (this.upperDir.existsSync(path)) {
            this.upperDir.unlinkSync(path);
        }
        this.lowerDir.unlinkSync(path);
    }
    /**
     * Asynchronously changes the access and modification times of the file referenced by path.
     * @param path Path to file.
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    async utimesAsync(path, atime, mtime) {
        try {
            this.upperDir.utimesSync(path, atime, mtime);
            await util_1.promisify(this.lowerDir.utimes)(path, atime, mtime);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Changes the access and modification times of the file referenced by path.
     * @param path Path to file.
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    utimes(path, atime, mtime, callback) {
        this.utimesAsync(path, atime, mtime).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously changes the access and modification times of the file referenced by path.
     * @param path Path to file.
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    utimesSync(path, atime, mtime) {
        this.upperDir.utimesSync(path, atime, mtime);
        this.lowerDir.utimesSync(path, atime, mtime);
    }
    /**
     * Asynchronously closes the file descriptor.
     * @param fd number. File descriptor.
     */
    async closeAsync(fd) {
        if (this.isFileDescriptor(fd)) {
            this.upperDir.closeSync(fd);
            const lowerFd = this.getLowerFd(fd);
            await util_1.promisify(this.lowerDir.close)(lowerFd);
        }
        else {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EBADF, null, null, 'close');
        }
    }
    /**
     * Closes the file descriptor.
     * @param fd number. File descriptor.
     */
    close(fd, callback) {
        this.closeAsync(fd).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously closes the file descriptor.
     * @param fd number. File descriptor.
     */
    closeSync(fd) {
        const isUserFileDescriptor = this.isFileDescriptor(fd);
        if (isUserFileDescriptor) {
            const lowerFd = this.getLowerFd(fd);
            this.lowerDir.closeSync(lowerFd);
            this.upperDir.closeSync(fd);
            this.fileDescriptors.delete(fd);
        }
    }
    /**
     * Asynchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param path Path to directory to be read.
     * @param options FileOptions.
     */
    async readdirAsync(path, options) {
        try {
            return await util_1.promisify(this.lowerDir.readdir)(path, options);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Writes buffer (with length) to the file descriptor at an offset and position.
     * @param path Path to directory to be read.
     * @param options FileOptions.
     */
    readdir(path, options, callback) {
        this.readdirAsync(path, options).then((contents) => {
            if (callback)
                callback(null, contents);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param path Path to directory to be read.
     * @param options FileOptions.
     */
    readdirSync(path, options) {
        return this.lowerDir.readdirSync(path, options);
    }
    /**
     * Creates a read stream from the given path and options.
     * @param path
     */
    createReadStream(path, options) {
        path = this.getPath(path);
        options = this.getStreamOptions({
            flags: 'r',
            encoding: undefined,
            fd: null,
            mode: constants_1.DEFAULT_FILE_PERM,
            autoClose: true,
            end: Infinity,
        }, options);
        if (options.start !== undefined) {
            if (options.start > options.end) {
                throw new RangeError('ERR_VALUE_OUT_OF_RANGE');
            }
        }
        return new Streams_1.ReadStream(path, options, this);
    }
    /**
     * Creates a write stream from the given path and options.
     * @param path
     */
    createWriteStream(path, options) {
        path = this.getPath(path);
        options = this.getStreamOptions({
            flags: 'w',
            encoding: 'utf8',
            fd: null,
            mode: constants_1.DEFAULT_FILE_PERM,
            autoClose: true,
        }, options);
        if (options.start !== undefined) {
            if (options.start < 0) {
                throw new RangeError('ERR_VALUE_OUT_OF_RANGE');
            }
        }
        return new Streams_1.WriteStream(path, options, this);
    }
    /**
     * Asynchronously checks if path exists.
     * @param path
     */
    async existsAsync(path) {
        // TODO: make sure upper and lower directories agree
        try {
            const existsInLower = await util_1.promisify(this.lowerDir.exists)(path);
            return existsInLower;
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Checks if path exists.
     * @param path
     */
    exists(path, callback) {
        // TODO: make sure upper and lower directories agree
        this.existsAsync(path).then((exists) => {
            if (callback)
                callback(null, exists);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously checks if path exists.
     * @param path
     */
    existsSync(path) {
        // TODO: make sure upper and lower directories agree
        return this.lowerDir.existsSync(path);
    }
    /**
     * Asynchronously manipulates the allocated disk space for a file.
     * @param fdIndex number. File descriptor index.
     * @param offset number. Offset to start manipulations from.
     * @param len number. New length for the file.
     */
    async fallocateAsync(fdIndex, offset, len) {
        return await util_1.promisify(this.upperDir.fallocate)(fdIndex, offset, len);
    }
    /**
     * Manipulates the allocated disk space for a file.
     * @param fdIndex number. File descriptor index.
     * @param offset number. Offset to start manipulations from.
     * @param len number. New length for the file.
     */
    fallocate(fdIndex, offset, len, callback) {
        this.fallocateAsync(fdIndex, offset, len).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously manipulates the allocated disk space for a file.
     * @param fdIndex number. File descriptor index.
     * @param offset number. Offset to start manipulations from.
     * @param len number. New length for the file.
     */
    fallocateSync(fdIndex, offset, len) {
        return this.upperDir.fallocateSync(fdIndex, offset, len);
    }
    /**
     * Asynchronously changes the permissions of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param mode number. New permissions set.
     */
    async fchmodAsync(fdIndex, mode = 0) {
        return await util_1.promisify(this.upperDir.fchmod)(fdIndex, mode);
    }
    /**
     * Changes the permissions of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param mode number. New permissions set.
     */
    fchmod(fdIndex, mode = 0, callback) {
        this.fchmodAsync(fdIndex, mode).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously changes the permissions of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param mode number. New permissions set.
     */
    fchmodSync(fdIndex, mode = 0) {
        return this.upperDir.fchmodSync(fdIndex, mode);
    }
    /**
     * Asynchronously changes the owner or group of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    async fchownAsync(fdIndex, uid, gid) {
        return await util_1.promisify(this.upperDir.fchown)(fdIndex, uid, gid);
    }
    /**
     * Changes the owner or group of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    fchown(fdIndex, uid, gid, callback) {
        this.fchownAsync(fdIndex, uid, gid).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously changes the owner or group of the file referred to by fdIndex.
     * @param fdIndex number. File descriptor index.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    fchownSync(fdIndex, uid, gid) {
        return this.upperDir.fchownSync(fdIndex, uid, gid);
    }
    /**
     * Asynchronously flushes in memory data to disk. Not required to update metadata.
     * @param fdIndex number. File descriptor index.
     */
    async fdatasyncAsync(fdIndex) {
        return await util_1.promisify(this.upperDir.fdatasync)(fdIndex);
    }
    /**
     * Flushes in memory data to disk. Not required to update metadata.
     * @param fdIndex number. File descriptor index.
     */
    fdatasync(fdIndex, callback) {
        this.fdatasyncAsync(fdIndex).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously flushes in memory data to disk. Not required to update metadata.
     * @param fdIndex number. File descriptor index.
     */
    fdatasyncSync(fdIndex) {
        return this.upperDir.fdatasyncSync(fdIndex);
    }
    /**
     * Asynchronously retrieves data about the file described by fdIndex.
     * @param fd number. File descriptor.
     */
    async fstatAsync(fd) {
        return await util_1.promisify(this.upperDir.fstat)(fd);
    }
    /**
     * Retrieves data about the file described by fdIndex.
     * @param fd number. File descriptor.
     */
    fstat(fd, callback) {
        this.fstatAsync(fd).then((stats) => {
            if (callback)
                callback(null, stats);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously retrieves data about the file described by fdIndex.
     * @param fd number. File descriptor.
     */
    fstatSync(fd) {
        return this.upperDir.fstatSync(fd);
    }
    /**
     * Asynchronously flushes all modified data to disk.
     * @param fdIndex number. File descriptor index.
     */
    async fsyncAsync(fdIndex) {
        return await util_1.promisify(this.upperDir.fsync)(fdIndex);
    }
    /**
     * Flushes all modified data to disk.
     * @param fdIndex number. File descriptor index.
     */
    fsync(fdIndex, callback) {
        this.fsyncAsync(fdIndex).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously flushes all modified data to disk.
     * @param fdIndex number. File descriptor index.
     */
    fsyncSync(fdIndex) {
        return this.upperDir.fsyncSync(fdIndex);
    }
    /**
     * Asynchronously truncates to given length.
     * @param fdIndex number. File descriptor index
     * @param len number. Length to truncate to.
     */
    async ftruncateAsync(fdIndex, len = 0) {
        return await util_1.promisify(this.upperDir.ftruncate)(fdIndex, len);
    }
    /**
     * Truncates to given length.
     * @param fdIndex number. File descriptor index
     * @param len number. Length to truncate to.
     */
    ftruncate(fdIndex, len = 0, callback) {
        this.ftruncateAsync(fdIndex, len).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously truncates to given length.
     * @param fdIndex number. File descriptor index
     * @param len number. Length to truncate to.
     */
    ftruncateSync(fdIndex, len = 0) {
        return this.upperDir.ftruncateSync(fdIndex, len);
    }
    /**
     * Asynchronously changes the access and modification times of the file referenced by fdIndex.
     * @param fdIndex number. File descriptor index
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    async futimesAsync(fdIndex, atime, mtime) {
        return await util_1.promisify(this.upperDir.futimes)(fdIndex, atime, mtime);
    }
    /**
     * Changes the access and modification times of the file referenced by fdIndex.
     * @param fdIndex number. File descriptor index
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    futimes(fdIndex, atime, mtime, callback) {
        this.futimesAsync(fdIndex, atime, mtime).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously changes the access and modification times of the file referenced by fdIndex.
     * @param fdIndex number. File descriptor index
     * @param atime number | string | Date. Access time.
     * @param mtime number | string | Date. Modification time.
     */
    futimesSync(fdIndex, atime, mtime) {
        return this.upperDir.futimesSync(fdIndex, atime, mtime);
    }
    /**
     * Asynchronously links a path to a new path.
     * @param existingPath
     * @param newPath
     */
    async linkAsync(existingPath, newPath) {
        await util_1.promisify(this.upperDir.link)(existingPath, newPath);
        await util_1.promisify(this.lowerDir.link)(existingPath, newPath);
    }
    /**
     * Links a path to a new path.
     * @param existingPath
     * @param newPath
     */
    link(existingPath, newPath, callback) {
        this.linkAsync(existingPath, newPath).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously links a path to a new path.
     * @param existingPath
     * @param newPath
     */
    linkSync(existingPath, newPath) {
        this.lowerDir.linkSync(existingPath, newPath);
        this.upperDir.linkSync(existingPath, newPath);
    }
    /**
     * Asynchronously reads data from a file given the path of that file.
     * @param path Path to file.
     */
    async readFileAsync(path, options) {
        const optionsInternal = this.getFileOptions({ encoding: null, mode: 0o666, flag: 'r' }, options);
        let fd = null;
        try {
            if (typeof path === 'number') {
                fd = path;
            }
            else {
                fd = await this.openAsync(path, optionsInternal.flag, optionsInternal.mode);
            }
            const size = this.getMetadata(fd).size;
            const readBuffer = Buffer.alloc(size);
            await this.readAsync(fd, readBuffer);
            return optionsInternal.encoding ? readBuffer.toString(optionsInternal.encoding) : readBuffer;
        }
        catch (err) {
            throw err;
        }
        finally {
            if (fd) {
                await this.closeAsync(fd);
            }
        }
    }
    /**
     * Reads data from a file given the path of that file.
     * @param path Path to file.
     */
    readFile(path, options, callback) {
        this.readFileAsync(path, options).then((data) => {
            if (callback)
                callback(null, data);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously reads data from a file given the path of that file.
     * @param path Path to file.
     */
    readFileSync(path, options) {
        const optionsInternal = this.getFileOptions({ encoding: null, mode: 0o666, flag: 'r' }, options);
        let fd = null;
        try {
            if (typeof path === 'number') {
                fd = path;
            }
            else {
                fd = this.openSync(path, optionsInternal.flag, optionsInternal.mode);
            }
            // Check if file descriptor points to directory
            if (this.fstatSync(fd).isDirectory()) {
                throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EISDIR, null, null, 'read');
            }
            const size = this.getMetadata(fd).size;
            const readBuffer = Buffer.alloc(size);
            this.readSync(fd, readBuffer, 0, size, 0);
            return optionsInternal.encoding ? readBuffer.toString(optionsInternal.encoding) : readBuffer;
        }
        finally {
            if (fd) {
                this.closeSync(fd);
            }
        }
    }
    /**
     * Synchronously reads link of the given the path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    async readlinkAsync(path, options) {
        try {
            return this.upperDir.readlinkSync(path, options);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Reads link of the given the path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    readlink(path, options, callback) {
        this.readlinkAsync(path, options).then((data) => {
            if (callback)
                callback(null, data);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously reads link of the given the path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    readlinkSync(path, options) {
        return this.upperDir.readlinkSync(path, options);
    }
    /**
     * Asynchronously determines the actual location of path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    async realpathAsync(path, options) {
        try {
            return await util_1.promisify(this.upperDir.realpath)(path, options);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Determines the actual location of path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    realpath(path, options, callback) {
        this.realpathAsync(path, options).then((path) => {
            if (callback)
                callback(null, path);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously determines the actual location of path. Propagated from upper fs.
     * @param path Path to file.
     * @param options FileOptions | undefined.
     */
    realpathSync(path, options = undefined) {
        return this.upperDir.realpathSync(path, options);
    }
    /**
     * Asynchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
     * @param oldPath Old path.
     * @param newPath New path.
     */
    async renameAsync(oldPath, newPath) {
        try {
            this.upperDir.renameSync(oldPath, newPath);
            await util_1.promisify(this.lowerDir.rename)(oldPath, newPath);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Renames the file system object described by oldPath to the given new path. Propagated from upper fs.
     * @param oldPath Old path.
     * @param newPath New path.
     */
    rename(oldPath, newPath, callback) {
        this.renameAsync(oldPath, newPath).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously renames the file system object described by oldPath to the given new path. Propagated from upper fs.
     * @param oldPath Old path.
     * @param newPath New path.
     */
    renameSync(oldPath, newPath) {
        return this.upperDir.renameSync(oldPath, newPath);
    }
    /**
     * Asynchronously reads data at an offset, position and length from a file descriptor into a given buffer.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The offset in the buffer at which to start writing.
     * @param length number. The number of bytes to read.
     * @param position number. The offset from the beginning of the file from which data should be read.
     */
    async readAsync(fd, buffer, offset = 0, length = buffer.length, position = 0) {
        if (offset < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'read');
        }
        if (length < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'read');
        }
        if (position < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'read');
        }
        // Check if file descriptor points to directory
        if (this.fstatSync(fd).isDirectory()) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EISDIR, null, null, 'read');
        }
        try {
            const lowerFd = this.getLowerFd(fd);
            const metadata = this.getMetadata(fd);
            if (position + length > metadata.size) {
                length = metadata.size - position;
            }
            // Init counters for incremental reading of blocks
            let bytesRead = 0;
            let targetStart = offset;
            // Determine chunk boundary conditions
            const numChunksToRead = Math.ceil(length / this.blockSize);
            const startBlockNum = this.offsetToBlockNum(position);
            const startChunkNum = startBlockNum;
            // Initialize write boundary conditions
            let blockBufferStart = this.getBoundaryOffset(position);
            // Begin reading chunks
            for (let chunkCtr = startChunkNum; chunkCtr - startChunkNum < numChunksToRead; chunkCtr++) {
                // Read the current block into chunkBuffer
                const chunkPosition = this.chunkNumToOffset(chunkCtr);
                const chunkBuffer = Buffer.alloc(this.chunkSize);
                await util_1.promisify(this.lowerDir.read)(lowerFd, chunkBuffer, 0, this.chunkSize, chunkPosition);
                // Extract blockBuffer from chukBuffer
                const blockBuffer = await this.crypto.decryptChunk(chunkBuffer);
                // Determine end condition of blockBuffer to write to
                const blockBufferEnd = length > bytesRead + blockBuffer.length ? blockBuffer.length : length - chunkCtr * this.blockSize;
                // Write blockBuffer to buffer
                const blockBytesRead = blockBuffer.copy(buffer, targetStart, blockBufferStart, blockBufferEnd);
                // Increment boundary variables
                bytesRead += blockBytesRead;
                targetStart += blockBytesRead;
                blockBufferStart += blockBytesRead;
            }
            return bytesRead;
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Reads data at an offset, position and length from a file descriptor into a given buffer.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The offset in the buffer at which to start writing.
     * @param length number. The number of bytes to read.
     * @param position number. The offset from the beginning of the file from which data should be read.
     */
    read(fd, buffer, offset = 0, length = buffer.length, position = 0, callback) {
        this.readAsync(fd, buffer, offset, length, position).then((bytesRead) => {
            if (callback)
                callback(null, bytesRead);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously reads data at an offset, position and length from a file descriptor into a given buffer.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be read into.
     * @param offset number. The offset in the buffer at which to start writing.
     * @param length number. The number of bytes to read.
     * @param position number. The offset from the beginning of the file from which data should be read.
     */
    readSync(fd, buffer, offset = 0, length = buffer.length, position = 0) {
        if (offset < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'readSync');
        }
        if (length < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'readSync');
        }
        if (position < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'readSync');
        }
        // Check if file descriptor points to directory
        if (this.fstatSync(fd).isDirectory()) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EISDIR, null, null, 'readSync');
        }
        try {
            const lowerFd = this.getLowerFd(fd);
            const metadata = this.getMetadata(fd);
            if (position + length > metadata.size) {
                length = metadata.size - position;
            }
            // Accumulate plain text blocks in buffer array
            const blockBuffers = [];
            // Determine chunk boundary conditions
            const numChunksToRead = Math.ceil(length / this.blockSize);
            const startBlockNum = this.offsetToBlockNum(position);
            const startChunkNum = startBlockNum;
            // Begin reading chunks
            for (let chunkCtr = startChunkNum; chunkCtr - startChunkNum < numChunksToRead; chunkCtr++) {
                // Read the current block into chunkBuffer
                const chunkPosition = this.chunkNumToOffset(chunkCtr);
                const chunkBuffer = Buffer.alloc(this.chunkSize);
                this.lowerDir.readSync(lowerFd, chunkBuffer, 0, this.chunkSize, chunkPosition);
                // Extract blockBuffer from chukBuffer
                const tempBlockBuffer = this.crypto.decryptChunkSync(chunkBuffer);
                blockBuffers.push(tempBlockBuffer);
            }
            // Create buffer of all read blockBuffers
            const blockBuffer = Buffer.concat(blockBuffers, numChunksToRead * this.blockSize);
            // Determine end condition of blockBuffer to write to
            const blockBufferStart = this.getBoundaryOffset(position);
            const blockBufferEnd = blockBufferStart + length;
            return blockBuffer.copy(buffer, offset, blockBufferStart, blockBufferEnd);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Asynchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
     * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
     * @param position number. The offset from the beginning of the file where this data should be written.
     */
    async writeAsync(fd, buffer, offset = 0, length = buffer.length - offset, position = 0) {
        if (offset < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'write');
        }
        if (length < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'write');
        }
        if (position < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'write');
        }
        // Check if file descriptor points to directory
        if (this.fstatSync(fd).isDirectory()) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EISDIR, null, null, 'write');
        }
        try {
            // Discriminate upper and lower file descriptors
            const upperFd = fd;
            const lowerFd = this.getLowerFd(fd);
            // Get block boundary conditions
            const boundaryOffset = this.getBoundaryOffset(position); // how far from a block boundary our write is
            const numBlocksToWrite = Math.ceil((boundaryOffset + length) / this.blockSize);
            const startBlockNum = this.offsetToBlockNum(position);
            const startChunkNum = startBlockNum;
            const endBlockNum = startBlockNum + numBlocksToWrite - 1;
            let bufferBytesWritten = 0;
            // ================== Handle first block ================== //
            const firstBlockStart = offset;
            const firstBlockEnd = firstBlockStart + Math.min(this.blockSize - boundaryOffset, length);
            const firstBlockOverlay = buffer.slice(firstBlockStart, firstBlockEnd);
            const firstBlock = await this.overlaySegment(upperFd, firstBlockOverlay, position);
            const firstChunk = await this.crypto.encryptBlock(firstBlock);
            bufferBytesWritten += firstBlockOverlay.length;
            // ================== Handle last block if needed ================== //
            const middleBlockLength = (numBlocksToWrite - 2) * this.blockSize;
            const lastBlockStart = firstBlockEnd + middleBlockLength;
            const lastBlockEnd = lastBlockStart + (length - (bufferBytesWritten + middleBlockLength));
            let lastBlock;
            let lastChunk;
            if (numBlocksToWrite >= 2) {
                const lastBlockOverlay = buffer.slice(lastBlockStart, lastBlockEnd);
                const lastBlockOffset = this.blockNumToOffset(endBlockNum);
                lastBlock = await this.overlaySegment(upperFd, lastBlockOverlay, lastBlockOffset);
                lastChunk = await this.crypto.encryptBlock(lastBlock);
                bufferBytesWritten += lastBlockOverlay.length;
            }
            else {
                lastBlock = null;
                lastChunk = null;
            }
            // ================== Handle middle blocks if needed ================== //
            // slice out middle blocks if they actually exist
            let middleBlocks = [];
            let middleChunks = [];
            if (numBlocksToWrite >= 3) {
                const middleBlockBuffer = buffer.slice(firstBlockEnd, lastBlockStart);
                const blockIter = this.blockGenerator(middleBlockBuffer);
                let middleBlockCtr = startBlockNum + 1;
                for (let block of blockIter) {
                    const middleBlockOffset = this.blockNumToOffset(middleBlockCtr);
                    const middleBlock = await this.overlaySegment(upperFd, block, middleBlockOffset);
                    const middleChunk = await this.crypto.encryptBlock(middleBlock);
                    middleBlocks.push(middleBlock);
                    middleChunks.push(middleChunk);
                    middleBlockCtr += 1;
                    bufferBytesWritten += block.length;
                }
            }
            // ================== Concat blocks and write ================== //
            let totalBlocks = [];
            totalBlocks.push(firstBlock);
            totalBlocks.push(...middleBlocks);
            if (lastBlock) {
                totalBlocks.push(lastBlock);
            }
            const blocks = Buffer.concat(totalBlocks, this.blockSize * numBlocksToWrite);
            // Write to upperDir (unencrypted)
            await util_1.promisify(this.upperDir.write)(upperFd, blocks, 0, blocks.length, this.blockNumToOffset(startBlockNum));
            // ================== Concat chunks and write ================== //
            let totalChunks = [];
            totalChunks.push(firstChunk);
            totalChunks.push(...middleChunks);
            if (lastChunk) {
                totalChunks.push(lastChunk);
            }
            const chunks = Buffer.concat(totalChunks, this.chunkSize * numBlocksToWrite);
            // Write to lowerDir (encrypted)
            await util_1.promisify(this.lowerDir.write)(lowerFd, chunks, 0, chunks.length, this.chunkNumToOffset(startChunkNum));
            // ================== Handle and write metadata ================== //
            const newFileSize = position + length;
            if (newFileSize > this.getMetadata(upperFd).size) {
                this.getMetadata(upperFd).size = newFileSize;
                this.writeMetadataSync(upperFd);
            }
            return bufferBytesWritten;
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Writes buffer (with length) to the file descriptor at an offset and position.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
     * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
     * @param position number. The offset from the beginning of the file where this data should be written.
     */
    write(fd, buffer, offset = 0, length = buffer.length - offset, position = 0, callback) {
        this.writeAsync(fd, buffer, offset, length, position).then((bytesWritten) => {
            if (callback)
                callback(null, bytesWritten);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    /**
     * Synchronously writes buffer (with length) to the file descriptor at an offset and position.
     * @param fd number. File descriptor.
     * @param buffer Buffer. Buffer to be written from.
     * @param offset number. The part of the buffer to be written. If not supplied, defaults to 0.
     * @param length number. The number of bytes to write. If not supplied, defaults to buffer.length - offset.
     * @param position number. The offset from the beginning of the file where this data should be written.
     */
    writeSync(fd, buffer, offset = 0, length = buffer.length - offset, position = 0) {
        if (offset < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'writeSync');
        }
        if (length < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'writeSync');
        }
        if (position < 0) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'writeSync');
        }
        // Check if file descriptor points to directory
        if (this.fstatSync(fd).isDirectory()) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EISDIR, null, null, 'writeSync');
        }
        try {
            // Discriminate upper and lower file descriptors
            const upperFd = fd;
            const lowerFd = this.getLowerFd(fd);
            // Get block boundary conditions
            const boundaryOffset = this.getBoundaryOffset(position); // how far from a block boundary our write is
            const numBlocksToWrite = Math.ceil((boundaryOffset + length) / this.blockSize);
            const startBlockNum = this.offsetToBlockNum(position);
            const startChunkNum = startBlockNum;
            const endBlockNum = startBlockNum + numBlocksToWrite - 1;
            let bufferBytesWritten = 0;
            // ================== Handle first block ================== //
            const firstBlockStart = offset;
            const firstBlockEnd = firstBlockStart + Math.min(this.blockSize - boundaryOffset, length);
            const firstBlockOverlay = buffer.slice(firstBlockStart, firstBlockEnd);
            const firstBlock = this.overlaySegmentSync(upperFd, firstBlockOverlay, position);
            const firstChunk = this.crypto.encryptBlockSync(firstBlock);
            bufferBytesWritten += firstBlockOverlay.length;
            // ================== Handle last block if needed ================== //
            const middleBlockLength = (numBlocksToWrite - 2) * this.blockSize;
            const lastBlockStart = firstBlockEnd + middleBlockLength;
            const lastBlockEnd = lastBlockStart + (length - (bufferBytesWritten + middleBlockLength));
            let lastBlock;
            let lastChunk;
            if (numBlocksToWrite >= 2) {
                const lastBlockOverlay = buffer.slice(lastBlockStart, lastBlockEnd);
                const lastBlockOffset = this.blockNumToOffset(endBlockNum);
                lastBlock = this.overlaySegmentSync(upperFd, lastBlockOverlay, lastBlockOffset);
                lastChunk = this.crypto.encryptBlockSync(lastBlock);
                bufferBytesWritten += lastBlockOverlay.length;
            }
            else {
                lastBlock = null;
                lastChunk = null;
            }
            // ================== Handle middle blocks if needed ================== //
            // slice out middle blocks if they actually exist
            let middleBlocks = [];
            let middleChunks = [];
            if (numBlocksToWrite >= 3) {
                const middleBlockBuffer = buffer.slice(firstBlockEnd, lastBlockStart);
                const blockIter = this.blockGenerator(middleBlockBuffer);
                let middleBlockCtr = startBlockNum + 1;
                for (let block of blockIter) {
                    const middleBlockOffset = this.blockNumToOffset(middleBlockCtr);
                    const middleBlock = this.overlaySegmentSync(upperFd, block, middleBlockOffset);
                    const middleChunk = this.crypto.encryptBlockSync(middleBlock);
                    middleBlocks.push(middleBlock);
                    middleChunks.push(middleChunk);
                    middleBlockCtr += 1;
                    bufferBytesWritten += block.length;
                }
            }
            // ================== Concat blocks and write ================== //
            let totalBlocks = [];
            totalBlocks.push(firstBlock);
            totalBlocks.push(...middleBlocks);
            if (lastBlock) {
                totalBlocks.push(lastBlock);
            }
            const blocks = Buffer.concat(totalBlocks, this.blockSize * numBlocksToWrite);
            // Write to upperDir (unencrypted)
            this.upperDir.writeSync(upperFd, blocks, 0, blocks.length, this.blockNumToOffset(startBlockNum));
            // ================== Concat chunks and write ================== //
            let totalChunks = [];
            totalChunks.push(firstChunk);
            totalChunks.push(...middleChunks);
            if (lastChunk) {
                totalChunks.push(lastChunk);
            }
            const chunks = Buffer.concat(totalChunks, this.chunkSize * numBlocksToWrite);
            // Write to lowerDir (encrypted)
            this.lowerDir.writeSync(lowerFd, chunks, 0, chunks.length, this.chunkNumToOffset(startChunkNum));
            // ================== Handle and write metadata ================== //
            const newFileSize = position + length;
            if (newFileSize > this.getMetadata(fd).size) {
                this.getMetadata(fd).size = newFileSize;
                this.writeMetadataSync(fd);
            }
            return bufferBytesWritten;
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Asynchronously append data to a file, creating the file if it does not exist.
     * @param file string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be appended.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     */
    async appendFileAsync(file, data, options) {
        const optionsInternal = this.getFileOptions({ encoding: 'utf8', mode: 0o666, flag: 'a' }, options);
        let fd = null;
        try {
            // Get file descriptor
            if (typeof file === 'number') {
                fd = file;
            }
            else {
                fd = await this.openAsync(file, optionsInternal.flag, optionsInternal.mode);
            }
            const upperFd = this.getUpperFd(fd);
            const lowerFd = this.getLowerFd(fd);
            await util_1.promisify(this.lowerDir.appendFile)(lowerFd, data, optionsInternal);
        }
        catch (err) {
            throw err;
        }
        finally {
            if (fd) {
                await this.closeAsync(fd);
            }
        }
    }
    /**
     * Append data to a file, creating the file if it does not exist.
     * @param file string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be appended.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     */
    appendFile(file, data, options, callback) {
        this.appendFileAsync(file, data, options).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously append data to a file, creating the file if it does not exist.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be appended.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     */
    appendFileSync(file, data, options) {
        const optionsInternal = this.getFileOptions({ encoding: 'utf8', mode: 0o666, flag: 'a' }, options);
        let fd = null;
        try {
            // Get file descriptor
            if (typeof file === 'number') {
                fd = file;
            }
            else {
                fd = this.openSync(file, optionsInternal.flag, optionsInternal.mode);
            }
            const upperFd = this.getUpperFd(fd);
            const lowerFd = this.getLowerFd(fd);
            this.lowerDir.appendFileSync(lowerFd, data, optionsInternal);
        }
        catch (err) {
            throw err;
        }
        finally {
            if (fd) {
                this.closeSync(fd);
            }
        }
    }
    /**
     * Asynchronously changes the access permissions of the file system object described by path.
     * @param path Path to the fs object.
     * @param mode number. New permissions set.
     */
    async chmodAsync(path, mode = 0) {
        try {
            await util_1.promisify(this.upperDir.chmod)(path, mode);
            await util_1.promisify(this.lowerDir.chmod)(path, mode);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Changes the access permissions of the file system object described by path.
     * @param path Path to the fs object.
     * @param mode number. New permissions set.
     */
    chmod(path, mode = 0, callback) {
        this.chmodAsync(path, mode).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously changes the access permissions of the file system object described by path.
     * @param path Path to the fs object.
     * @param mode number. New permissions set.
     */
    chmodSync(path, mode = 0) {
        this.upperDir.chmodSync(path, mode);
        this.lowerDir.chmodSync(path, mode);
    }
    /**
     * Asynchronously changes the owner or group of the file system object described by path.
     * @param path Path to the fs object.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    async chownAsync(path, uid, gid) {
        try {
            await util_1.promisify(this.upperDir.chown)(path, uid, gid);
            await util_1.promisify(this.lowerDir.chown)(path, uid, gid);
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Changes the owner or group of the file system object described by path.
     * @param path Path to the fs object.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    chown(path, uid, gid, callback) {
        this.chownAsync(path, uid, gid).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously changes the owner or group of the file system object described by path.
     * @param path Path to the fs object.
     * @param uid number. User identifier.
     * @param gid number. Group identifier.
     */
    chownSync(path, uid, gid) {
        this.upperDir.chownSync(path, uid, gid);
        this.lowerDir.chownSync(path, uid, gid);
    }
    /**
     * Asynchronously writes data to the path specified with some FileOptions.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be written.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined } | undefined
     */
    async writeFileAsync(path, data, options) {
        try {
            const optionsInternal = this.getFileOptions({ encoding: 'utf8', mode: 0o666, flag: 'w' }, options);
            const isUserFileDescriptor = this.isFileDescriptor(path);
            let fd;
            if (isUserFileDescriptor) {
                fd = path;
            }
            else if (typeof path == 'string') {
                fd = await this.openAsync(path, optionsInternal.flag, optionsInternal.mode);
            }
            else {
                throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EBADF, null, null, 'writeFile');
            }
            let offset = 0;
            if (typeof data === 'string') {
                data = Buffer.from(data);
            }
            let length = data.byteLength;
            // const position = /a/.test(flag) ? null : 0
            let position = 0;
            while (length > 0) {
                const written = await this.writeAsync(fd, data, offset, length, position);
                offset += written;
                length -= written;
                if (position !== null) {
                    position += written;
                }
            }
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Writes data to the path specified with some FileOptions.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. The data to be written.
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined } | undefined
     */
    writeFile(path, data, options, callback) {
        this.writeFileAsync(path, data, options).then(() => {
            if (callback)
                callback(null);
        }).catch((err) => {
            if (callback)
                callback(err);
        });
    }
    /**
     * Synchronously writes data to the path specified with some FileOptions.
     * @param path string | number. Path to the file or directory.
     * @param data string | Buffer. Defines the data to be .
     * @param options FileOptions: { encoding: CharacterEncodingString mode: number | undefined flag: string | undefined }.
     * Default options are: { encoding: "utf8", mode: 0o666, flag: "w" }.
     */
    writeFileSync(path, data, options = {}) {
        try {
            const optionsInternal = this.getFileOptions({ encoding: 'utf8', mode: 0o666, flag: 'w' }, options);
            const isUserFileDescriptor = this.isFileDescriptor(path);
            let fd;
            if (isUserFileDescriptor) {
                fd = path;
            }
            else if (typeof path === 'string') {
                fd = this.openSync(path, optionsInternal.flag, optionsInternal.mode);
            }
            else {
                throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EBADF, null, null, 'writeFileSync');
            }
            let offset = 0;
            if (typeof data === 'string') {
                data = Buffer.from(data);
            }
            let length = data.byteLength;
            // let position = /a/.test(flag) ? null : 0
            let position = 0;
            while (length > 0) {
                const written = this.writeSync(fd, data, offset, length, position);
                offset += written;
                length -= written;
                if (position !== null) {
                    position += written;
                }
            }
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Asynchronously opens a file or directory and returns the file descriptor.
     * @param path Path to the file or directory.
     * @param flags Flags for read/write operations. Defaults to 'r'.
     * @param mode number. Read and write permissions. Defaults to 0o666.
     */
    async openAsync(path, flags = 'r', mode = 0o666) {
        var _a;
        try {
            const _path = this.getPath(path);
            // Open on lowerDir
            let lowerFd = await util_1.promisify(this.lowerDir.open)(_path, flags, mode);
            // Check if a file
            if ((await util_1.promisify(this.lowerDir.fstat)(lowerFd)).isFile()) {
                // Open with write permissions as well
                await util_1.promisify(this.lowerDir.close)(lowerFd);
                const lowerFlags = flags[0] === 'w' ? 'w+' : 'r+';
                lowerFd = await util_1.promisify(this.lowerDir.open)(_path, lowerFlags, mode);
            }
            const upperFilePath = path_1.default.resolve(_path);
            // Need to make path if it doesn't exist already
            if (!this.upperDir.existsSync(upperFilePath)) {
                const upperFilePathDir = path_1.default.dirname(upperFilePath);
                // mkdirp
                await util_1.promisify(this.upperDir.mkdirp)(upperFilePathDir);
                // create file if needed
                await util_1.promisify(this.upperDir.close)(await util_1.promisify(this.upperDir.open)(upperFilePath, 'w'));
            }
            // Open on upperDir
            const upperFd = await util_1.promisify(this.upperDir.open)(upperFilePath, flags, mode);
            // Create efsFd
            const efsFd = new FileDescriptor_1.default(lowerFd, upperFd, flags.toString());
            this.fileDescriptors.set(upperFd, efsFd);
            // If file descriptor points to file, write metadata
            const isFile = (_a = this.fstatSync(upperFd)) === null || _a === void 0 ? void 0 : _a.isFile();
            if (isFile) {
                if (flags[0] === 'r') {
                    await this.loadMetadata(upperFd);
                }
                else if (flags[0] === 'w') {
                    const hash = this.crypto.hashSync(this.masterKey);
                    this.metadata[upperFd] = { keyHash: hash, size: 0 };
                    this.writeMetadataSync(upperFd);
                }
            }
            return upperFd;
        }
        catch (err) {
            throw err;
        }
    }
    /**
     * Opens a file or directory and returns the file descriptor.
     * @param path Path to the file or directory.
     * @param flags Flags for read/write operations. Defaults to 'r'.
     * @param mode number. Read and write permissions. Defaults to 0o666.
     */
    open(path, flags = 'r', mode = 0o666, callback) {
        this.openAsync(path, flags, mode).then((fd) => {
            if (callback)
                callback(null, fd);
        }).catch((err) => {
            if (callback)
                callback(err, null);
        });
    }
    // TODO: actually implement flags
    // TODO: w+ should truncate, r+ should not
    /**
     * Synchronously opens a file or directory and returns the file descriptor.
     * @param path Path to the file or directory.
     * @param flags Flags for read/write operations. Defaults to 'r'.
     * @param mode number. Read and write permissions. Defaults to 0o666.
     */
    openSync(path, flags = 'r', mode = 0o666) {
        var _a;
        try {
            const _path = this.getPath(path);
            // Open on lowerDir
            let lowerFd = this.lowerDir.openSync(_path, flags, mode);
            // Check if a directory
            if (this.lowerDir.fstatSync(lowerFd).isFile()) {
                // Open with write permissions as well
                this.lowerDir.closeSync(lowerFd);
                const lowerFlags = flags[0] === 'w' ? 'w+' : 'r+';
                lowerFd = this.lowerDir.openSync(_path, lowerFlags, mode);
            }
            const upperFilePath = path_1.default.resolve(_path);
            // Need to make path if it doesn't exist already
            if (!this.upperDir.existsSync(upperFilePath)) {
                const upperFilePathDir = path_1.default.dirname(upperFilePath);
                // mkdirp
                this.upperDir.mkdirpSync(upperFilePathDir);
                // create file if needed
                this.upperDir.closeSync(this.upperDir.openSync(upperFilePath, 'w'));
            }
            // Open on upperDir
            const upperFd = this.upperDir.openSync(upperFilePath, flags, mode);
            // Create efsFd
            const efsFd = new FileDescriptor_1.default(lowerFd, upperFd, flags.toString());
            this.fileDescriptors.set(upperFd, efsFd);
            // If file descriptor points to file, write metadata
            const isFile = (_a = this.fstatSync(upperFd)) === null || _a === void 0 ? void 0 : _a.isFile();
            if (isFile) {
                if (flags[0] === 'r') {
                    this.loadMetadataSync(upperFd);
                }
                else if (flags[0] === 'w') {
                    const hash = this.crypto.hashSync(this.masterKey);
                    this.metadata[upperFd] = { keyHash: hash, size: 0 };
                    this.writeMetadataSync(upperFd);
                }
            }
            return upperFd;
        }
        catch (err) {
            throw err;
        }
    }
    lchown(path, uid, gid, callback) {
        throw new Error('Method not implemented');
    }
    lchownSync(path, uid, gid) {
        throw new Error('Method not implemented');
    }
    lchmod(path, mode, callback) {
        throw new Error('Method not implemented');
    }
    lchmodSync(path, mode) {
        throw new Error('Method not implemented');
    }
    watchFile(filename, options, listener) {
        throw new Error('Method not implemented');
    }
    unwatchFile(filename, listener) {
        throw new Error('Method not implemented');
    }
    watch(filename, options, listener) {
        throw new Error('Method not implemented');
    }
    copyFile(src, dest, callback) {
        throw new Error('Method not implemented');
    }
    copyFileSync(src, dest) {
        throw new Error('Method not implemented');
    }
    writev(fd, buffers, cb) {
        throw new Error('Method not implemented');
    }
    writevSync(fd, buffers, position) {
        throw new Error('Method not implemented');
    }
    readv(fd, buffers, cb) {
        throw new Error('Method not implemented');
    }
    readvSync(fd, buffers, position) {
        throw new Error('Method not implemented');
    }
    opendirSync(path, options) {
        throw new Error('Method not implemented');
    }
    opendir(path, cb) {
        throw new Error('Method not implemented');
    }
    /**
     * Get key used for encryption.
     */
    getKey() {
        return this.masterKey;
    }
    // ============= HELPER FUNCTIONS ============= //
    getFileOptions(defaultOptions, options) {
        let optionsFinal = defaultOptions;
        if (typeof options === 'string') {
            if (!this.isCharacterEncoding(options)) {
                throw Error('Invalid encoding string');
            }
            return { ...defaultOptions, encoding: options };
        }
        if (options) {
            if (options.encoding) {
                if (this.isCharacterEncoding(options.encoding)) {
                    optionsFinal = { ...optionsFinal, encoding: options.encoding };
                }
                else {
                    throw Error('Invalid encoding string');
                }
            }
            if (options.flag) {
                optionsFinal = { ...optionsFinal, flag: options.flag };
            }
            if (options.mode) {
                optionsFinal = { ...optionsFinal, mode: options.mode };
            }
        }
        return optionsFinal;
    }
    getStreamOptions(defaultOptions, options) {
        let optionsFinal = defaultOptions;
        if (typeof options === 'string') {
            if (!this.isCharacterEncoding(options)) {
                throw Error('Invalid encoding string');
            }
            return { ...defaultOptions, encoding: options };
        }
        if (options) {
            if (options.highWaterMark) {
                optionsFinal = { ...optionsFinal, highWaterMark: options.highWaterMark };
            }
            if (options.flags) {
                optionsFinal = { ...optionsFinal, flags: options.flags };
            }
            if (options.encoding) {
                if (this.isCharacterEncoding(options.encoding)) {
                    optionsFinal = { ...optionsFinal, encoding: options.encoding };
                }
                else {
                    throw Error('Invalid encoding string');
                }
            }
            if (options.fd) {
                optionsFinal = { ...optionsFinal, fd: options.fd };
            }
            if (options.mode) {
                optionsFinal = { ...optionsFinal, mode: options.mode };
            }
            if (options.autoClose) {
                optionsFinal = { ...optionsFinal, autoClose: options.autoClose };
            }
            if (options.start) {
                optionsFinal = { ...optionsFinal, start: options.start };
            }
            if (options.end) {
                optionsFinal = { ...optionsFinal, end: options.end };
            }
        }
        return optionsFinal;
    }
    isCharacterEncoding(encoding) {
        if (encoding == null || encoding == undefined) {
            return false;
        }
        return ['ascii', 'utf8', 'utf-8', 'utf16le', 'ucs2', 'ucs-2', 'base64', 'latin1', 'binary', 'hex'].includes(encoding);
    }
    /**
     * Asynchronously reads the whole block that the position lies within.
     * @param fd File descriptor.
     * @param position Position of data required.
     */
    async readBlock(fd, position) {
        const blockBuf = Buffer.alloc(this.blockSize);
        // First check if its a new block or empty
        const metadata = this.getMetadata(fd);
        if (metadata.size == 0) {
            return blockBuf.fill(0);
        }
        // Read non-empty block
        const blockNum = this.offsetToBlockNum(position);
        const blockOffset = this.blockNumToOffset(blockNum);
        await this.readAsync(fd, blockBuf, 0, this.blockSize, blockOffset);
        return blockBuf;
    }
    /**
     * Synchronously reads the whole block that the position lies within.
     * @param fd File descriptor.
     * @param position Position of data required.
     */
    readBlockSync(fd, position) {
        const blockBuf = Buffer.alloc(this.blockSize);
        // First check if its a new block or empty
        const metadata = this.getMetadata(fd);
        if (metadata.size == 0) {
            return blockBuf.fill(0);
        }
        // Read non-empty block
        const blockNum = this.offsetToBlockNum(position);
        const blockOffset = this.blockNumToOffset(blockNum);
        this.readSync(fd, blockBuf, 0, this.blockSize, blockOffset);
        return blockBuf;
    }
    // #TODO:
    // TODO: what happens if file is less than block size?
    /**
     * Asynchronously reads from disk the chunk containing the block that needs to be merged with new block
     * @param fd File descriptor.
     * @param newData Buffer containing the new data.
     * @param position Position of the insertion.
     */
    async overlaySegment(fd, newData, position) {
        // 	case 1:  segment is aligned to start of block and ends at end of block      |<------->|
        // 	case 2:  segment is aligned to start-of-block but end before end-of-block   |<----->--|
        // 	case 3:  segment is not aligned to start and ends before end-of-block       |--<--->--|
        // 	case 4:  segment is not aligned to start-of-block and ends at end-of-block  |--<----->|
        //
        // 	Cases 3 and 4 are not possible when overlaying the last segment
        const writeOffset = this.getBoundaryOffset(position); // byte offset from where to start writing new data in the block
        // Optimization: skip read if newData is block size and position is writeOffset is 0
        if (writeOffset === 0 && newData.length === this.blockSize) {
            return newData;
        }
        // Make sure newData won't be written over block boundary
        if (writeOffset + newData.length > this.blockSize) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'overlaySegment');
        }
        // Read relevant block
        const originalBlock = await this.readBlock(fd, position);
        const isBlockStartAligned = writeOffset === 0;
        // Get the start slice if newData is not block start aligned
        let startSlice = Buffer.alloc(0);
        if (!isBlockStartAligned) {
            startSlice = originalBlock.slice(0, writeOffset);
        }
        // Any data reamining after new block
        const endSlice = originalBlock.slice(writeOffset + newData.length);
        // Patch up slices to create new block
        const newBlock = Buffer.concat([startSlice, newData, endSlice]);
        return newBlock;
    }
    /**
     * Synchronously Reads from disk the chunk containing the block that needs to be merged with new block
     * @param fd File descriptor.
     * @param newData Buffer containing the new data.
     * @param position Position of the insertion.
     */
    overlaySegmentSync(fd, newData, position) {
        const writeOffset = this.getBoundaryOffset(position); // byte offset from where to start writing new data in the block
        // Optimization: skip read if newData is block aligned and length is blockSize
        if (writeOffset === 0 && newData.length === this.blockSize) {
            return newData;
        }
        // Make sure newData won't be written over block boundary
        if (writeOffset + newData.length > this.blockSize) {
            throw new EncryptedFSError_1.EncryptedFSError(EncryptedFSError_1.errno.EINVAL, null, null, 'overlaySegmentSync');
        }
        // Read relevant block
        const originalBlock = this.readBlockSync(fd, position);
        const isBlockStartAligned = writeOffset === 0;
        // Get the start slice if newData is not block start aligned
        let startSlice = Buffer.alloc(0);
        if (!isBlockStartAligned) {
            startSlice = originalBlock.slice(0, writeOffset);
        }
        // Any data reamining after new block
        const endSlice = originalBlock.slice(writeOffset + newData.length);
        // Patch up slices to create new block
        const newBlock = Buffer.concat([startSlice, newData, endSlice]);
        return newBlock;
    }
    /**
     * Gets the byte offset from the beginning of the block that position lies within
     * @param position: number. Position.
     */
    getBoundaryOffset(position) {
        // Position can start from 0 but block size starts counting from 1
        // Compare apples to apples first and then subtract 1
        return ((position + 1) % this.blockSize) - 1;
    }
    /**
     * Checks if path is a file descriptor (number) or not (string).
     * @param path Path of file.
     */
    isFileDescriptor(path) {
        if (typeof path === 'number') {
            if (this.fileDescriptors.has(path)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Retrieves the upperFd from an efs fd index.
     * @param fdIndex File descriptor.
     */
    getUpperFd(fdIndex) {
        if (this.fileDescriptors.has(fdIndex)) {
            const efsFd = this.fileDescriptors.get(fdIndex);
            if (efsFd) {
                const upperFd = efsFd.getUpperFd();
                if (upperFd !== undefined || upperFd !== null) {
                    return upperFd;
                }
                else {
                    throw Error('efs file descriptor is undefined');
                }
            }
            else {
                throw Error('efs file descriptor is undefined');
            }
        }
        else {
            throw Error('efs file descriptor does not exist');
        }
    }
    /**
     * Retrieves the lowerFd from an efs fd index.
     * @param fdIndex File descriptor.
     */
    getLowerFd(fdIndex) {
        if (this.fileDescriptors.has(fdIndex)) {
            const efsFd = this.fileDescriptors.get(fdIndex);
            if (efsFd) {
                const lowerFd = efsFd.getLowerFd();
                if (lowerFd !== undefined || lowerFd !== null) {
                    return lowerFd;
                }
                else {
                    throw Error('efs file descriptor is undefined');
                }
            }
            else {
                throw Error('efs file descriptor is undefined');
            }
        }
        else {
            throw Error('efs file descriptor does not exist');
        }
    }
    /**
     * Takes a position in a file and returns the block number that 'position' lies in.
     * @param position
     */
    offsetToBlockNum(position) {
        // we use blockSize as opposed to chunkSize because chunk contains metadata
        // transparent to user. When user specifies position it is as if it were plaintext
        return Math.floor(position / this.blockSize);
    }
    /**
     * Calculates the offset/position of the block number in the unencrypted file.
     * @param blockNum Block number.
     */
    blockNumToOffset(blockNum) {
        return blockNum * this.blockSize;
    }
    /**
     * Calculates the offset/position of the chunk number in the unencrypted file.
     * @param chunkNum Chunk number.
     */
    chunkNumToOffset(chunkNum) {
        return chunkNum * this.chunkSize;
    }
    /**
     * Creates a block generator for block iteration, split is per block length.
     * @param blocks Buffer containing blocks to be split.
     * @param blockSize Size of an individual block.
     */
    *blockGenerator(blocks, blockSize = this.blockSize) {
        let iterCount = 0;
        let currOffset = 0;
        while (currOffset < blocks.length) {
            yield blocks.slice(currOffset, currOffset + blockSize);
            currOffset += blockSize;
            iterCount++;
        }
    }
    /**
     * Creates a chunk generator for chunk iteration, split is per block length.
     * @param chunks Buffer containing blocks to be split.
     * @param chunkSize Size of an individual block.
     */
    *chunkGenerator(chunks, chunkSize = this.chunkSize) {
        let iterCount = 0;
        let currOffset = 0;
        while (currOffset < chunks.length) {
            yield chunks.slice(currOffset, currOffset + chunkSize);
            currOffset += chunkSize;
            iterCount++;
        }
    }
    /**
     * Synchronously checks if file (fd) contains conntent or not.
     * @param fd File descriptor.
     */
    hasContentSync(fd) {
        const hasContent = this.lowerDir.fstatSync(fd).size !== 0;
        return hasContent;
    }
    /**
     * Synchronously checks for file size.
     * @param fd File descriptor.
     */
    getPostWriteFileSize(fd, position, length) {
        const fileMeta = this.metadata[fd];
        const newSize = position + length;
        const fileSize = fileMeta.size;
        if (newSize > fileSize) {
            fileMeta.size = newSize;
            return newSize;
        }
        else {
            return fileSize;
        }
    }
    writeMetadataSync(fd) {
        const metadata = this.getMetadata(fd);
        const serialMeta = JSON.stringify(metadata);
        const metadataBockBuffer = Buffer.concat([Buffer.from(serialMeta)], this.blockSize);
        const metadataChunkBuffer = this.crypto.encryptBlockSync(metadataBockBuffer);
        const metadataOffset = this.getMetadataOffsetSync(fd);
        this.lowerDir.writeSync(this.getLowerFd(fd), metadataChunkBuffer, 0, metadataChunkBuffer.length, metadataOffset);
    }
    async loadMetadata(fd) {
        const metaChunk = Buffer.alloc(this.chunkSize);
        const metaChunkOffset = this.getMetadataOffsetSync(fd);
        await util_1.promisify(this.lowerDir.read)(this.getLowerFd(fd), metaChunk, 0, metaChunk.length, metaChunkOffset);
        const metaBlock = await this.crypto.decryptChunk(metaChunk);
        const metaPlainTrimmed = metaBlock.slice(0, metaBlock.indexOf('\0'));
        const fileMeta = eval('(' + metaPlainTrimmed.toString() + ')');
        this.metadata[fd] = fileMeta;
    }
    loadMetadataSync(fd) {
        const metaChunk = Buffer.alloc(this.chunkSize);
        const metaChunkOffset = this.getMetadataOffsetSync(fd);
        this.lowerDir.readSync(this.getLowerFd(fd), metaChunk, 0, metaChunk.length, metaChunkOffset);
        const metaBlock = this.crypto.decryptChunkSync(metaChunk);
        const metaPlainTrimmed = metaBlock.slice(0, metaBlock.indexOf('\0'));
        const fileMeta = eval('(' + metaPlainTrimmed.toString() + ')');
        this.metadata[fd] = fileMeta;
    }
    getMetadata(fd) {
        if (this.metadata.hasOwnProperty(fd)) {
            const fileMeta = this.metadata[fd];
            if (fileMeta) {
                return fileMeta;
            }
        }
        throw Error('file descriptor has no metadata stored');
    }
    getMetaField(fd, fieldName) {
        const fileMeta = this.getMetadata(fd);
        if (fileMeta.hasOwnProperty(fieldName)) {
            const fieldVal = fileMeta[fieldName];
            if (fieldVal != null) {
                return fieldVal;
            }
        }
        throw Error('Field does not exist');
    }
    getMetadataOffsetSync(fd) {
        const efsFd = this.getEfsFd(fd);
        const stats = this.lowerDir.fstatSync(this.getLowerFd(fd));
        const size = stats.size;
        if (efsFd.getFlags()[0] === 'w') {
            return size;
        }
        const numBlocks = size / this.chunkSize;
        return this.chunkNumToOffset(numBlocks - 1);
    }
    getEfsFd(fd) {
        if (this.fileDescriptors.has(fd)) {
            const efsFd = this.fileDescriptors.get(fd);
            if (efsFd) {
                return efsFd;
            }
        }
        throw Error('file descriptor has no metadata stored');
    }
    /**
     * Processes path types and collapses it to a string.
     * The path types can be string or Buffer or URL.
     * @private
     */
    getPath(path) {
        if (typeof path === 'string') {
            return path;
        }
        if (path instanceof Buffer) {
            return path.toString();
        }
        if (path instanceof URL) {
            return this.getPathFromURL(path);
        }
        throw new TypeError('path must be a string or Buffer or URL');
    }
    /**
     * Acquires the file path from an URL object.
     * @private
     */
    getPathFromURL(url) {
        if (url.hasOwnProperty('hostname')) {
            throw new TypeError('ERR_INVALID_FILE_URL_HOST');
        }
        const pathname = url.pathname;
        if (pathname.match(/%2[fF]/)) {
            // must not allow encoded slashes
            throw new TypeError('ERR_INVALID_FILE_URL_PATH');
        }
        return decodeURIComponent(pathname);
    }
}
exports.default = EncryptedFS;
//# sourceMappingURL=EncryptedFS.js.map