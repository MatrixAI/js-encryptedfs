import { CustomError } from 'ts-custom-error';

class ErrorINodes extends CustomError {}

class ErrorINodesIndexMissing extends ErrorINodes {}

class ErrorINodesParentMissing extends ErrorINodes {}

class ErrorINodesInvalidName extends ErrorINodes {}

export {
  ErrorINodes,
  ErrorINodesIndexMissing,
  ErrorINodesParentMissing,
  ErrorINodesInvalidName
};
