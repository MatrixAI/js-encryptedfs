"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants = Object.freeze({
    O_RDONLY: 0,
    O_WRONLY: 1,
    O_RDWR: 2,
    O_ACCMODE: 3,
    S_IFMT: 61440,
    S_IFREG: 32768,
    S_IFDIR: 16384,
    S_IFCHR: 8192,
    S_IFBLK: 24576,
    S_IFIFO: 4096,
    S_IFLNK: 40960,
    S_IFSOCK: 49152,
    O_CREAT: 64,
    O_EXCL: 128,
    O_NOCTTY: 256,
    O_TRUNC: 512,
    O_APPEND: 1024,
    O_DIRECTORY: 65536,
    O_NOATIME: 262144,
    O_NOFOLLOW: 131072,
    O_SYNC: 1052672,
    O_DIRECT: 16384,
    O_NONBLOCK: 2048,
    S_IRWXU: 448,
    S_IRUSR: 256,
    S_IWUSR: 128,
    S_IXUSR: 64,
    S_IRWXG: 56,
    S_IRGRP: 32,
    S_IWGRP: 16,
    S_IXGRP: 8,
    S_IRWXO: 7,
    S_IROTH: 4,
    S_IWOTH: 2,
    S_IXOTH: 1,
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
    COPYFILE_EXCL: 1,
    SEEK_SET: 0,
    SEEK_CUR: 1,
    SEEK_END: 2,
    MAP_SHARED: 1,
    MAP_PRIVATE: 2,
});
exports.constants = constants;
/**
 * Default file permissions of `rw-rw-rw-`.
 */
const DEFAULT_FILE_PERM = constants.S_IRUSR | constants.S_IWUSR | constants.S_IRGRP | constants.S_IWGRP | constants.S_IROTH | constants.S_IWOTH;
exports.DEFAULT_FILE_PERM = DEFAULT_FILE_PERM;
//# sourceMappingURL=constants.js.map