import type { DeviceInterface, CharacterDev, FileDescriptor } from 'virtualfs';

import { EncryptedFSError, errno } from '../EncryptedFSError';

const fullDev: DeviceInterface<CharacterDev> = {
  setPos: (
    fd: FileDescriptor<CharacterDev>,
    position: number,
    flags: number,
  ) => {
    fd._pos = 0;
    return;
  },
  read: (
    fd: FileDescriptor<CharacterDev>,
    buffer: Buffer,
    position: number,
  ) => {
    buffer.fill(0);
    return buffer.length;
  },
  write: (
    fd: FileDescriptor<CharacterDev>,
    buffer: Buffer,
    position: number,
    extraFlags: number,
  ) => {
    throw new EncryptedFSError(errno.ENOSPC);
  },
};

export default fullDev;
