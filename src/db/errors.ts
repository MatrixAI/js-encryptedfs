import { CustomError } from 'ts-custom-error';

class ErrorDB extends CustomError {}

class ErrorDBStarted extends ErrorDB {}

class ErrorDBNotStarted extends ErrorDB {}

class ErrorDBDestroyed extends ErrorDB {}

class ErrorDBLevelPrefix extends ErrorDB {}

class ErrorDBDecrypt extends ErrorDB {}

class ErrorDBParse extends ErrorDB {}

class ErrorDBKeyRead extends ErrorDB {}

class ErrorDBKeyWrite extends ErrorDB {}

class ErrorDBKeyParse extends ErrorDB {}

class ErrorDBCommitted extends ErrorDB {}

class ErrorDBNotCommited extends ErrorDB {}

class ErrorDBRollbacked extends ErrorDB {}


export {
  ErrorDB,
  ErrorDBStarted,
  ErrorDBNotStarted,
  ErrorDBDestroyed,
  ErrorDBLevelPrefix,
  ErrorDBDecrypt,
  ErrorDBParse,
  ErrorDBKeyRead,
  ErrorDBKeyWrite,
  ErrorDBKeyParse,
  ErrorDBCommitted,
  ErrorDBNotCommited,
  ErrorDBRollbacked
};
