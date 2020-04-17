
export { default as EncryptedFS } from './EncryptedFS';

// polyfills to be exported
// $FlowFixMe: Buffer exists
export { Buffer } from 'buffer';
// $FlowFixMe: nextTick exists
export { nextTick } from 'process';