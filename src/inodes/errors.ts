import { CustomError } from 'ts-custom-error';

class ErrorINodes extends CustomError {}

class ErrorINodesIndexMissing extends ErrorINodes {}

class ErrorINodesParentMissing extends ErrorINodes {}

class ErrorINodesInvalidName extends ErrorINodes {}

// return Promise.reject(new Error('Not allowed to add `.` or `..` entries'));

export {
  ErrorINodes,
  ErrorINodesIndexMissing,
  ErrorINodesParentMissing,
  ErrorINodesInvalidName
};
