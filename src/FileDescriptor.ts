class FileDescriptor {
  private _lowerFd: number;
  private _upperFd: number;
  private _flags: string;
  constructor(lowerFd: number, upperFd: number, flags: string) {
    this._lowerFd = lowerFd;
    this._upperFd = upperFd;
    this._flags = flags;
  }

  getUpperFd(): number {
    return this._upperFd;
  }

  getLowerFd(): number {
    return this._lowerFd;
  }

  getFlags(): string {
    return this._flags;
  }
}

export default FileDescriptor;
