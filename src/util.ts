import { spawn, Pool, Worker, ModuleThread } from 'threads';
import { EncryptedFSCryptoWorker } from './EncryptedFSCryptoWorker';

const cryptoConstants = Object.freeze({
  SALT_LEN: 64,
  INIT_VECTOR_LEN: 12,
  AUTH_TAG_LEN: 16,
  KEY_LEN: 32,
  PBKDF_NUM_ITERATIONS: 9816,
});

function initializeWorkerPool(numWorkers: number = 8): Pool<ModuleThread<EncryptedFSCryptoWorker>> {
  return Pool(() => spawn<EncryptedFSCryptoWorker>(new Worker('./EncryptedFSCryptoWorker.ts')), numWorkers);
}

export { cryptoConstants, initializeWorkerPool };
