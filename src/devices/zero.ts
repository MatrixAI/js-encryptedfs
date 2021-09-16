import type { DeviceInterface, CharacterDev, FileDescriptor } from 'virtualfs';

const zeroDev: DeviceInterface<CharacterDev> = {
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
    fd: FileDescriptor<CharacterDev>,
    buffer: Buffer,
    _position: number,
    _extraFlags: number,
  ) => {
    return buffer.length;
  },
};

export default zeroDev;
