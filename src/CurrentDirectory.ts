import type { INodeManager } from './inodes';
import type { INodeIndex } from './inodes/types';

class CurrentDirectory {

  protected _ino: INodeIndex;
  protected _curPath: Array<string>;
  protected _iNodeMgr: INodeManager;

  constructor (
    iNodeMgr: INodeManager,
    ino: INodeIndex,
    curPath: Array<string> = []
  ) {
    this._iNodeMgr = iNodeMgr;
    this._ino = ino;
    this._curPath = curPath;
    this._iNodeMgr.ref(ino);
  }

  public async changeDir(ino: INodeIndex, curPath: Array<string>): Promise<void> {
    this._iNodeMgr.ref(ino);
    await this._iNodeMgr.transact(async (tran) => {
      await this._iNodeMgr.unref(tran, this._ino);
    })
    this._ino = ino;
    this._curPath = curPath;
  }

  get ino(): INodeIndex {
    return this._ino;
  }

  get pathStack(): Array<string> {
    return [...this._curPath];
  }

  get path(): string {
    return '/' + this._curPath.join('/');
  }
}

export default CurrentDirectory;
