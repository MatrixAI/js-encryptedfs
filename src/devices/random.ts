import type { DeviceInterface, CharacterDev, FileDescriptor } from 'virtualfs';

import * as utils from '../utils';

const randomDev: DeviceInterface<CharacterDev> = {
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
    _position: number,
    _extraFlags: number,
  ) => {
    return buffer.length;
  },
};

export default randomDev;
