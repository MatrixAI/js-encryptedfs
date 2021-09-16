import type { DeviceInterface, CharacterDev, FileDescriptor } from 'virtualfs';

const nullDev: DeviceInterface<CharacterDev> = {
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
    return 0;
  },
  write: (
    fd: FileDescriptor<CharacterDev>,
    buffer: Buffer,
    position: number,
    extraFlags: number,
  ) => {
    return buffer.length;
  },
};

export default nullDev;
