import { pbkdf2, random } from 'node-forge';

enum EncryptedFSLayers {
  upper = 'upper',
  lower = 'lower',
}

const cryptoConstants = Object.freeze({
  SALT_LEN: 64,
  INIT_VECTOR_LEN: 16,
  AUTH_TAG_LEN: 16,
  KEY_LEN: 16,
  PBKDF_NUM_ITERATIONS: 9816,
});

function generateMasterKey(password: string): Buffer {
  const salt = getRandomBytesSync(cryptoConstants.SALT_LEN);
  return pbkdf2(
    Buffer.from(password),
    salt,
    cryptoConstants.PBKDF_NUM_ITERATIONS,
    cryptoConstants.KEY_LEN,
    'sha512',
  );
}

function getRandomBytesSync(size: number): Buffer {
  return Buffer.from(random.getBytesSync(size), 'binary');
}

function promisify<T>(f): (...args: any[]) => Promise<T> {
  return function <T>(...args): Promise<T> {
    return new Promise((resolve, reject) => {
      const callback = (error, ...values) => {
        if (error) {
          return reject(error);
        }
        return resolve(values.length === 1 ? values[0] : values);
      };
      args.push(callback);
      f.apply(this, args);
    });
  };
}

export {
  EncryptedFSLayers,
  cryptoConstants,
  generateMasterKey,
  getRandomBytesSync,
  promisify,
};
