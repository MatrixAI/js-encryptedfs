import { CustomError } from 'ts-custom-error';

class EncryptedFSWorkerError extends CustomError {}

class EncryptedFSWorkerNotRunningError extends EncryptedFSWorkerError {}

export { EncryptedFSWorkerError, EncryptedFSWorkerNotRunningError };
