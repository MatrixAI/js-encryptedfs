"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const threads_1 = require("threads");
const crypto = __importStar(require("crypto"));
const _cryptorWorker = {
    updateCipher(algorithm, key, initVector, plainBuf) {
        console.log('webworker cipher');
        let _cipher = _cryptorWorker._createCipheriv(algorithm, Buffer.from(key), Buffer.from(initVector));
        return _cipher.update(plainBuf);
    },
    _createCipheriv(algorithm, key, initVector) {
        return crypto.createCipheriv(algorithm, Buffer.from(key), Buffer.from(initVector));
    },
    updateDecipher(algorithm, key, initVector, plainBuf) {
        let _decipher = _cryptorWorker._createDecipheriv(algorithm, Buffer.from(key), Buffer.from(initVector));
        return _decipher.update(plainBuf);
    },
    _createDecipheriv(algorithm, key, initVector) {
        return crypto.createDecipheriv(algorithm, Buffer.from(key), Buffer.from(initVector));
    }
};
threads_1.expose(_cryptorWorker);
//# sourceMappingURL=CryptorWorker.js.map