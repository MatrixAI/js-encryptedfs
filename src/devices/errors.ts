import { CustomError } from 'ts-custom-error';

class DeviceError extends CustomError {
  public static errorRange = 1;
  public static errorConflict = 2;
  public readonly code: number;

  constructor(code: number, message?: string) {
    super(message);
    this.code = code;
  }
}

export { DeviceError };
