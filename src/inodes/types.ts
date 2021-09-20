import type { StatProps } from '../Stat';
import type { Opaque } from '../types';

type INodeIndex = Opaque<'INodeIndex', number>;

type INodeId = Opaque<'INodeId', Buffer>;

type INodeType = 'File' | 'Directory' | 'Symlink';

type INodeData = {
  ino: INodeIndex;
  type: INodeType;
  gc: boolean;
};

type INodeParams = Partial<StatProps> & Pick<StatProps, 'ino' | 'mode'>;

type BufferIndex = number;

type BufferId = Opaque<'BufferId', Buffer>;

export type {
  INodeIndex,
  INodeId,
  INodeType,
  INodeParams,
  INodeData,
  BufferIndex,
  BufferId,
};
