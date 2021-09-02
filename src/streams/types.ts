import type { FdIndex } from '../fd/types';

type optionsStream = {
  highWaterMark?: number,
  flags?: string,
  encoding?: BufferEncoding,
  fd?: FdIndex,
  mode?: number,
  autoClose?: boolean,
  start?: number,
  end?: number
};

export {
  optionsStream,
}
