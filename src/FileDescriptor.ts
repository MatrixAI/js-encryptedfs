class FileDescriptor {
  private _lowerFd: number;
  private _metaPath: string;
  private _upperFd: number;
  private _flags: string;
  constructor(
    lowerFd: number,
    metaPath: string,
    upperFd: number,
    flags: string,
  ) {
    this._lowerFd = lowerFd;
    this._metaPath = metaPath;
    this._upperFd = upperFd;
    this._flags = flags;
  }

  getUpperFd(): number {
    return this._upperFd;
  }

  getLowerFd(): number {
    return this._lowerFd;
  }

  getMetaPath(): string {
    return this._metaPath;
  }

  getFlags(): string {
    return this._flags;
  }
}

export default FileDescriptor;
