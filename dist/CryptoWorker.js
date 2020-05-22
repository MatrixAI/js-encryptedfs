"use strict";
var __importStar =
  (this && this.__importStar) ||
  function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null)
      for (var k in mod)
        if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
  };
Object.defineProperty(exports, "__esModule", { value: true });
const worker_1 = require("threads/worker");
const crypto = __importStar(require("crypto"));
const util_1 = require("./util");
function encryptBlock(blockBuffer, masterKey, algorithm, salt, initVector) {
  // Initialize cipher
  const key = crypto.pbkdf2Sync(
    masterKey,
    salt,
    util_1.cryptoConstants.PBKDF_NUM_ITERATIONS,
    util_1.cryptoConstants.KEY_LEN,
    "sha512"
  );
  const cipher = crypto.createCipheriv(algorithm, key, initVector);
  // Encrypt the blockBuffer
  const encrypted = Buffer.concat([cipher.update(blockBuffer), cipher.final()]);
  // Extract the auth tag
  const tag = cipher.getAuthTag();
  // Construct chunk
  return Buffer.concat([salt, initVector, tag, encrypted]);
}
function decryptChunk(chunkBuffer, masterKey, algorithm) {
  // Deconstruct chunk into metadata and encrypted data
  const {
    salt,
    initVector,
    authTag,
    encryptedBuffer,
  } = util_1.deconstructChunk(chunkBuffer);
  // Initialize decipher
  const key = crypto.pbkdf2Sync(
    masterKey,
    salt,
    util_1.cryptoConstants.PBKDF_NUM_ITERATIONS,
    util_1.cryptoConstants.KEY_LEN,
    "sha512"
  );
  const decipher = crypto.createDecipheriv(algorithm, key, initVector);
  decipher.setAuthTag(authTag);
  // Decrypt into blockBuffer
  const blockBuffer = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ]);
  return blockBuffer;
}
worker_1.expose({
  encryptBlock,
  decryptChunk,
});
//# sourceMappingURL=CryptoWorker.js.map
