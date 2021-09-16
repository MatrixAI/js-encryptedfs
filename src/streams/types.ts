import type { FdIndex } from '../fd/types';

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

export { OptionsStream };
