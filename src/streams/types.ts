import type { FdIndex } from '../fd/types.js';

type OptionsStream = {
  highWaterMark?: number;
  flags?: string;
  encoding?: BufferEncoding;
  fd?: FdIndex;
  mode?: number;
  autoClose?: boolean;
  start?: number;
  end?: number;
};

export type { OptionsStream };
