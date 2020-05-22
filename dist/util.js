"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const threads_1 = require("threads");
const cryptoConstants = Object.freeze({
    SALT_LEN: 64,
    INIT_VECTOR_LEN: 12,
    AUTH_TAG_LEN: 16,
    KEY_LEN: 32,
    PBKDF_NUM_ITERATIONS: 9816,
});
exports.cryptoConstants = cryptoConstants;
function initializeWorkerPool(numWorkers = 8) {
    return threads_1.Pool(() => threads_1.spawn(new threads_1.Worker('./EncryptedFSCryptoWorker.ts')), numWorkers);
}
exports.initializeWorkerPool = initializeWorkerPool;
//# sourceMappingURL=util.js.map