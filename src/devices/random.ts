import type { DeviceInterface, CharacterDev, FileDescriptor } from 'virtualfs';

import * as utils from '../utils';

const randomDev: DeviceInterface<CharacterDev> = {
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
    const randomBuf = Buffer.from(
      utils.getRandomBytesSync(buffer.length).toString(),
      'ascii',
    );
    randomBuf.copy(buffer);
    return randomBuf.length;
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

export default randomDev;
