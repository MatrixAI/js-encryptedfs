import type { DeviceInterface, CharacterDev, FileDescriptor } from 'virtualfs';

import { EncryptedFSError, errno } from '../EncryptedFSError';

const fullDev: DeviceInterface<CharacterDev> = {
  setPos: (
    fd: FileDescriptor<CharacterDev>,
    _position: number,
    _flags: number,
  ) => {
    fd._pos = 0;
    return;
  },
  read: (
    fd: FileDescriptor<CharacterDev>,
    buffer: Buffer,
    _position: number,
  ) => {
    buffer.fill(0);
    return buffer.length;
  },
  write: (
    _fd: FileDescriptor<CharacterDev>,
    _buffer: Buffer,
    _position: number,
    _extraFlags: number,
  ) => {
    throw new EncryptedFSError(errno.ENOSPC);
  },
};

export default fullDev;
