import { CustomError } from 'ts-custom-error';

class ErrorFileDescriptor extends CustomError {}

class ErrorFileDescriptorMissingINode extends ErrorFileDescriptor {}

class ErrorFileDescriptorInvalidPosition extends ErrorFileDescriptor {}

class ErrorFileDescriptorInvalidINode extends ErrorFileDescriptor {}

export {
  ErrorFileDescriptor,
  ErrorFileDescriptorMissingINode,
  ErrorFileDescriptorInvalidPosition,
  ErrorFileDescriptorInvalidINode,
};
