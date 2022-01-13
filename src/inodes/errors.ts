import { CustomError } from 'ts-custom-error';

class ErrorINodes extends CustomError {}

class ErrorINodesRunning extends ErrorINodes {}

class ErrorINodesNotRunning extends ErrorINodes {}

class ErrorINodesDestroyed extends ErrorINodes {}

class ErrorINodesDuplicateRoot extends ErrorINodes {}

class ErrorINodesIndexMissing extends ErrorINodes {}

class ErrorINodesParentMissing extends ErrorINodes {}

class ErrorINodesInvalidName extends ErrorINodes {}

export {
  ErrorINodes,
  ErrorINodesRunning,
  ErrorINodesNotRunning,
  ErrorINodesDestroyed,
  ErrorINodesDuplicateRoot,
  ErrorINodesIndexMissing,
  ErrorINodesParentMissing,
  ErrorINodesInvalidName,
};
