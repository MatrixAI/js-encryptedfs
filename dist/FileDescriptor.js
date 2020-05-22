"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class FileDescriptor {
    constructor(lowerFd, upperFd, flags) {
        this._lowerFd = lowerFd;
        this._upperFd = upperFd;
        this._flags = flags;
    }
    getUpperFd() {
        return this._upperFd;
    }
    getLowerFd() {
        return this._lowerFd;
    }
    getFlags() {
        return this._flags;
    }
}
exports.default = FileDescriptor;
//# sourceMappingURL=FileDescriptor.js.map