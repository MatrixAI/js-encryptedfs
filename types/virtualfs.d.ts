declare module 'virtualfs' {
  import type { PathLike } from 'fs';
  type NoParamCallback = (err: VirtualFSError | null) => void;
  type Metadata = {
    dev?: number,
    ino: number,
    mode: number,
    nlink: number,
    uid: number,
    gid: number,
    rdev?: number,
    size: number,
    atime: Date,
    mtime: Date,
    ctime: Date,
    birthtime: Date
  };
  export default class VirtualFSSingle {}
  export class VirtualFSError {
    public errno: number;
    public code: string;
    public errnoDescription: string;
    public syscall?: string;
    constructor (
      errnoObj: {errno: number, code: string, description: string},
      path?: string,
      dest?: string,
      syscall?: string
    );
    public setPaths(src: string, dst?: string): void;
    public setSyscall(syscall: string): void;
  }
  export class VirtualFS {
    constructor (
      umask?: number,
      rootIndex?: number|null,
      devMgr?: DeviceManager,
      iNodeMgr?: INodeManager,
      fdMgr?: FileDescriptorManager
    );
    public getCwd(): string;
    public chdir (path: string): void;
    public access(path: PathLike, mode: number | undefined, callback: NoParamCallback): void;
    public access(path: PathLike, callback: NoParamCallback): void;
    public accessSync(path: PathLike, mode: number): void;
    public exists(path: PathLike, callback: (exists: boolean) => void): void;
    public existsSync(path: PathLike): boolean;
    public open(path: PathLike, flags: string|number, mode: number | undefined, callback: (err: VirtualFSError | null, fd: number) => void): void;
    public open(path: PathLike, flags: string|number, callback: (err: VirtualFSError | null, fd: number) => void): void;
    public openSync(path: PathLike, flags: string|number, mode?: number): number;
    public close(fdIndex: number, callback: NoParamCallback): void;
    public closeSync(fdIndex: number): void;
    public _getPath(p: PathLike): string;
  }
  export class Stat {
    constructor (props: Metadata);
  }
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
