import type { DeviceInterface, CharacterDev, FileDescriptor } from 'virtualfs';

import fs from 'fs';
import process from 'process';

import { EncryptedFSError, errno } from '../EncryptedFSError';

let fds = 0;
let ttyInFd;
let ttyOutFd;

const ttyDev: DeviceInterface<CharacterDev> = {
  open: (_fd: FileDescriptor<CharacterDev>) => {
    if (fds === 0) {
      if (process.release && process.release.name === 'node') {
        ttyOutFd = process.stdout.fd;
        if (process.platform === 'win32') {
          // On windows, stdin is in blocking mode
          // NOTE: on windows node repl environment, stdin is in raw mode
          //       make sure to set process.stdin.setRawMode(false)
          ttyInFd = process.stdin.fd;
        } else {
          // On non-windows, stdin is in non-blocking mode
          // to get blocking semantics we need to reopen stdin
          try {
            // If there are problems opening this
            // we assume there is no stdin
            ttyInFd = fs.openSync('/dev/fd/0', 'rs');
          } catch (e) {
            return;
          }
        }
      }
    }
    ++fds;
  },
  close: (_fd: FileDescriptor<CharacterDev>) => {
    --fds;
    if (fds === 0) {
      if (ttyInFd && fs) {
        fs.closeSync(ttyInFd);
      }
    }
  },
  read: (
    fd: FileDescriptor<CharacterDev>,
    buffer: Buffer,
    _position: number,
  ) => {
    if (ttyInFd !== null && fs) {
      return fs.readSync(ttyInFd, buffer, 0, buffer.length, null);
    } else {
      if (window && window.prompt) {
        return Buffer.from(window.prompt() as any).copy(buffer);
      }
      throw new EncryptedFSError(errno.ENXIO);
    }
  },
  write: (
    fd: FileDescriptor<CharacterDev>,
    buffer: Buffer,
    _position: number,
    _extraFlags: number,
  ) => {
    if (ttyOutFd !== null && fs) {
      return fs.writeSync(ttyOutFd, buffer);
    } else {
      console.log(buffer.toString());
      return buffer.length;
    }
  },
};

export default ttyDev;
