import { CustomError } from 'ts-custom-error';

class ErrorWorkers extends CustomError {}

class ErrorNotRunning extends ErrorWorkers {}

export { ErrorWorkers, ErrorNotRunning };
