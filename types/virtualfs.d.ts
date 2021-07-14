declare module 'virtualfs' {
  import type { PathLike } from 'fs';
  export default class VirtualFSSingle {}
  class VirtualFS {
    constructor(
      umask?: number,
      rootIndex?: number|null,
      devMgr?: DeviceManager,
      iNodeMgr?: INodeManager,
      fdMgr?: FileDescriptorManager
    );
    public getCwd(): string;
    public chdir (path: string): void;
    public _getPath(p: PathLike): string;
  }
  class Stat {}
  const constants;
  class FileDescriptorManager {
    constructor (
      iNodeMgr: INodeManager
    );
  }
  class INodeManager {
    constructor (
      devMgr: DeviceManager
    );
  }
  class DeviceManager {}
}
