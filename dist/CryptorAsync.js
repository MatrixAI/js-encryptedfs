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
let currentCount = 0;
const _cryptorAsync = {
    updateCipher(algorithm, key, initVector, plainBuf) {
        console.log('webworker cipher');
        let _cipher = crypto.createCipheriv(algorithm, Buffer.from(key), Buffer.from(initVector));
        console.log(_cipher);
        return _cipher.update(plainBuf);
    },
    increment() {
        return ++currentCount;
    },
    decrement() {
        return --currentCount;
    }
};
threads_1.expose(_cryptorAsync);
//# sourceMappingURL=CryptorAsync.js.map