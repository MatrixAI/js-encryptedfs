"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var EncryptedFS_1 = require("./EncryptedFS");
exports.EncryptedFS = EncryptedFS_1.default;
var Cryptor_1 = require("./Cryptor");
exports.Cryptor = Cryptor_1.default;
// polyfills to be exported
// $FlowFixMe: Buffer exists
var buffer_1 = require("buffer");
exports.Buffer = buffer_1.Buffer;
// $FlowFixMe: nextTick exists
var process_1 = require("process");
exports.nextTick = process_1.nextTick;
//# sourceMappingURL=index.js.map