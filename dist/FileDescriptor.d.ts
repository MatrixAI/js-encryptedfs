declare class FileDescriptor {
    private _lowerFd;
    private _upperFd;
    private _flags;
    constructor(lowerFd: number, upperFd: number, flags: string);
    getUpperFd(): number;
    getLowerFd(): number;
    getFlags(): string;
}
export default FileDescriptor;
