/**
 * Class representing an encrypted file system error.
 * @extends Error
 */
declare class EncryptedFSError extends Error {
    errno: number;
    code: string;
    errnoDescription: string;
    syscall?: string;
    /**
     * Creates EncryptedFSError.
     */
    constructor(errnoObj: {
        errno: number;
        code: string;
        description: string;
    }, path?: string | null, dest?: string | null, syscall?: string | null);
    setPaths(src: string, dst?: string): void;
    setSyscall(syscall: string): void;
}
export { EncryptedFSError };
export { code as errno } from 'errno';
