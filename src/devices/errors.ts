import { CustomError } from 'ts-custom-error';

class DeviceError extends CustomError {

  public static ERROR_RANGE: number;
  public static ERROR_CONFLICT: number;
  public readonly code: number;

  constructor (code: number, message?: string) {
    super(message);
    this.code = code;
  }

}

Object.defineProperty(
  DeviceError,
  'ERROR_RANGE',
  {value: 1}
);

Object.defineProperty(
  DeviceError,
  'ERROR_CONFLICT',
  {value: 2}
);

export { DeviceError };
