import type { CharacterDev, DeviceInterface } from 'virtualfs';

import Counter from 'resource-counter';

import { DeviceError } from './errors';
import * as devices from '../constants/devices';

class DeviceManager {
  protected _chrCounterMaj: Counter;
  protected _chrDevices: Map<
    number,
    [Map<number, DeviceInterface<CharacterDev>>, Counter]
  >;

  constructor() {
    this._chrCounterMaj = new Counter(devices.MAJOR_MIN);
    this._chrDevices = new Map();
  }

  getChr(
    major: number,
    minor: number,
  ): DeviceInterface<CharacterDev> | undefined {
    const devicesAndCounterMin = this._chrDevices.get(major);
    if (devicesAndCounterMin) {
      const [devicesMin] = devicesAndCounterMin;
      return devicesMin.get(minor);
    }
    return;
  }

  registerChr(
    device: DeviceInterface<CharacterDev>,
    major: number | void,
    minor: number | void,
  ): void {
    let autoAllocMaj: number | void;
    let autoAllocMin: number | void;
    let counterMin: Counter;
    let devicesMin: Map<number, DeviceInterface<CharacterDev>> | void;
    try {
      if (major === undefined) {
        major = this._chrCounterMaj.allocate();
        autoAllocMaj = major;
      } else {
        const devicesCounterMin = this._chrDevices.get(major);
        if (!devicesCounterMin) {
          this._chrCounterMaj.allocate(major);
          autoAllocMaj = major;
        } else {
          [devicesMin, counterMin] = devicesCounterMin;
        }
      }
      if (!devicesMin || !counterMin) {
        counterMin = new Counter(devices.MINOR_MIN);
        devicesMin = new Map();
      }
      if (minor === undefined) {
        minor = counterMin.allocate();
        autoAllocMin = minor;
      } else {
        if (!devicesMin.has(minor)) {
          counterMin.allocate(minor);
          autoAllocMin = minor;
        } else {
          throw new DeviceError(DeviceError.errorConflict);
        }
      }
      if (
        major > devices.MAJOR_MAX ||
        major < devices.MAJOR_MIN ||
        minor > devices.MINOR_MAX ||
        minor < devices.MINOR_MIN
      ) {
        throw new DeviceError(DeviceError.errorRange);
      }
      devicesMin.set(minor as number, device);
      this._chrDevices.set(major as number, [devicesMin, counterMin]);
      return;
    } catch (e) {
      if (autoAllocMaj != null) {
        this._chrCounterMaj.deallocate(autoAllocMaj);
      }
      if (autoAllocMin != null && counterMin) {
        counterMin.deallocate(autoAllocMin);
      }
      throw e;
    }
  }

  deregisterChr(major: number, minor: number): void {
    const devicesCounterMin = this._chrDevices.get(major);
    if (devicesCounterMin) {
      const [devicesMin, counterMin] = devicesCounterMin;
      if (devicesMin.delete(minor)) {
        counterMin.deallocate(minor);
      }
      if (!devicesMin.size) {
        this._chrDevices.delete(major);
        this._chrCounterMaj.deallocate(major);
      }
    }
    return;
  }
}

export default DeviceManager;
