import type { DeviceInterface, CharacterDev, FileDescriptor } from 'virtualfs';

const nullDev: DeviceInterface<CharacterDev> = {
  setPos: (
    fd: FileDescriptor<CharacterDev>,
    _position: number,
    _flags: number,
  ) => {
    fd._pos = 0;
    return;
  },
  read: (
    _fd: FileDescriptor<CharacterDev>,
    _buffer: Buffer,
    _position: number,
  ) => {
    return 0;
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

export default nullDev;
