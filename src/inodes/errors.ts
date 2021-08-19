import { CustomError } from 'ts-custom-error';

class ErrorINodes extends CustomError {}

class ErrorINodesDuplicateRoot extends ErrorINodes {}

class ErrorINodesIndexMissing extends ErrorINodes {}

class ErrorINodesParentMissing extends ErrorINodes {}

class ErrorINodesInvalidName extends ErrorINodes {}

export {
  ErrorINodes,
  ErrorINodesDuplicateRoot,
  ErrorINodesIndexMissing,
  ErrorINodesParentMissing,
  ErrorINodesInvalidName
};
