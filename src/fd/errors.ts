import { AbstractError } from '@matrixai/errors';

class ErrorFileDescriptor<T> extends AbstractError<T> {
  static description = 'File descriptor error';
}

class ErrorFileDescriptorInvalidPosition<T> extends ErrorFileDescriptor<T> {
  static description = 'File descriptor position cannot be less than 0';
}

class ErrorFileDescriptorInvalidINode<T> extends ErrorFileDescriptor<T> {
  static description = 'File descriptor cannot handle unknown INode type';
}

export {
  ErrorFileDescriptor,
  ErrorFileDescriptorInvalidPosition,
  ErrorFileDescriptorInvalidINode,
};
