type UpperDirectoryMetadata = {
  size: number;
  keyHash: Buffer;
};

type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'latin1'
  | 'binary'
  | 'hex';

export type { UpperDirectoryMetadata, BufferEncoding };
