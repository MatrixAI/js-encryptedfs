import type {
  INodeIndex,
  INodeId,
  BufferIndex,
  BufferId
} from './types';

import lexi from 'lexicographic-integer';

function iNodeId(index: INodeIndex): INodeId {
  return Buffer.from(lexi.pack(index)) as INodeId;
}

function uniNodeId(id: INodeId): INodeIndex {
  return lexi.unpack([...(id as Buffer)]);
}

function bufferId(index: BufferIndex): BufferId {
  return Buffer.from(lexi.pack(index)) as BufferId;
}

function unbufferId(id: BufferId): BufferIndex {
  return lexi.unpack([...(id as Buffer)]);
}

export {
  iNodeId,
  uniNodeId,
  bufferId,
  unbufferId
};
