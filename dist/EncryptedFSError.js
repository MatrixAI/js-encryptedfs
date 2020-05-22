"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Class representing an encrypted file system error.
 * @extends Error
 */
class EncryptedFSError extends Error {
    /**
     * Creates EncryptedFSError.
     */
    constructor(errnoObj, path, dest, syscall) {
        let message = errnoObj.code + ': ' + errnoObj.description;
        if (path != null) {
            message += ', ' + path;
            if (dest != null)
                message += ' -> ' + dest;
        }
        super(message);
        this.errno = errnoObj.errno;
        this.code = errnoObj.code;
        this.errnoDescription = errnoObj.description;
        if (syscall != null) {
            this.syscall = syscall;
        }
    }
    setPaths(src, dst) {
        let message = this.code + ': ' + this.errnoDescription + ', ' + src;
        if (dst != null)
            message += ' -> ' + dst;
        this.message = message;
        return;
    }
    setSyscall(syscall) {
        this.syscall = syscall;
    }
}
exports.EncryptedFSError = EncryptedFSError;
var errno_1 = require("errno");
exports.errno = errno_1.code;
//# sourceMappingURL=EncryptedFSError.js.map