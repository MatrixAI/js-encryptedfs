import { AbstractError } from '@matrixai/errors';

class ErrorINodes<T> extends AbstractError<T> {
  static description = 'INodes error';
}

class ErrorINodeManagerRunning<T> extends ErrorINodes<T> {
  static description = 'INodeManager is running';
}

class ErrorINodeManagerNotRunning<T> extends ErrorINodes<T> {
  static description = 'INodeManager is not running';
}

class ErrorINodeManagerDestroyed<T> extends ErrorINodes<T> {
  static description = 'INodeManager is destroyed';
}

class ErrorINodesDuplicateRoot<T> extends ErrorINodes<T> {
  static description = 'Only a single root INode is allowed';
}

class ErrorINodesIndexMissing<T> extends ErrorINodes<T> {
  static description = 'INode cannot be found';
}

class ErrorINodesParentMissing<T> extends ErrorINodes<T> {
  static description = 'Parent INode cannot be found during directory creation';
}

class ErrorINodesInvalidName<T> extends ErrorINodes<T> {
  static description =
    'Old entry cannot be found during directory entry renaming';
}

export {
  ErrorINodes,
  ErrorINodeManagerRunning,
  ErrorINodeManagerNotRunning,
  ErrorINodeManagerDestroyed,
  ErrorINodesDuplicateRoot,
  ErrorINodesIndexMissing,
  ErrorINodesParentMissing,
  ErrorINodesInvalidName,
};
