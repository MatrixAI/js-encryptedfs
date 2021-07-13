import type { MutexInterface } from 'async-mutex';
import type { StatProps } from '../Stat';
import type { Opaque } from '../types';

type INodeIndex = number;

type INodeId = Opaque<'INodeId', Buffer>;

type INodeType = 'File' | 'Directory' | 'Symlink' | 'CharacterDev';

type INodeData = {
  type: INodeType;
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
  BufferId
};
