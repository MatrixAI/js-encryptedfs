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

enum EncryptedFSLayers {
  upper = 'upper',
  lower = 'lower',
}

export type { UpperDirectoryMetadata, BufferEncoding };
export { EncryptedFSLayers };
