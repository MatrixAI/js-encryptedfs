declare module 'virtualfs' {
  import type { PathLike } from 'fs';
  type NoParamCallback = (err: VirtualFSError | null) => void;
  export default class VirtualFSSingle {}
  export class VirtualFSError {}
  export class VirtualFS {
    constructor(
      umask?: number,
      rootIndex?: number|null,
      devMgr?: DeviceManager,
      iNodeMgr?: INodeManager,
      fdMgr?: FileDescriptorManager
    );
    public getCwd(): string;
    public chdir (path: string): void;
    public access(p: PathLike, mode: number | undefined, callback: NoParamCallback): void;
    public access(p: PathLike, callback: NoParamCallback): void;
    public accessSync(p: PathLike, mode: number): void;
    public exists(p: PathLike, callback: (exists: boolean) => void): void;
    public existsSync(p: PathLike): boolean;
    public _getPath(p: PathLike): string;
  }
  export class Stat {}
  export namespace constants {
    const O_RDONLY: number;
    const O_WRONLY: number;
    const O_RDWR: number;
    const O_ACCMODE: number;
    const S_IFMT: number;
    const S_IFREG: number;
    const S_IFDIR: number;
    const S_IFCHR: number;
    const S_IFBLK: number;
    const S_IFIFO: number;
    const S_IFLNK: number;
    const S_IFSOCK: number;
    const O_CREAT: number;
    const O_EXCL: number;
    const O_NOCTTY: number;
    const O_TRUNC: number;
    const O_APPEND: number;
    const O_DIRECTORY: number;
    const O_NOATIME: number;
    const O_NOFOLLOW: number;
    const O_SYNC: number;
    const O_DIRECT: number;
    const O_NONBLOCK: number;
    const S_IRWXU: number;
    const S_IRUSR: number;
    const S_IWUSR: number;
    const S_IXUSR: number;
    const S_IRWXG: number;
    const S_IRGRP: number;
    const S_IWGRP: number;
    const S_IXGRP: number;
    const S_IRWXO: number;
    const S_IROTH: number;
    const S_IWOTH: number;
    const S_IXOTH: number;
    const F_OK: number;
    const R_OK: number;
    const W_OK: number;
    const X_OK: number;
    const COPYFILE_EXCL: number;
    const SEEK_SET: number;
    const SEEK_CUR: number;
    const SEEK_END: number;
    const MAP_SHARED: number;
    const MAP_PRIVATE: number;
  }
  export class FileDescriptorManager {
    constructor (
      iNodeMgr: INodeManager
    );
  }
  export class INodeManager {
    constructor (
      devMgr: DeviceManager
    );
  }
  export class DeviceManager {}
}
