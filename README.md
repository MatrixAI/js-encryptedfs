# js-encryptedfs

[![pipeline status](https://gitlab.com/MatrixAI/open-source/js-encryptedfs/badges/master/pipeline.svg)](https://gitlab.com/MatrixAI/open-source/js-encryptedfs/commits/master)

Encrypted filesystem library for TypeScript/JavaScript applications

* Virtualised - files, directories, permissions are all virtual constructs, they do not correspond to real filesystems
* Orthogonally Persistent - all writes automatically persisted
* Encrypted-At-Rest - all persistence is encrypted
* Random Read & Write - encryption and decryption operates over fixed-block sizes
* Streamable - files do not need to loaded fully in-memory

Development based on js-virtualfs: https://github.com/MatrixAI/js-virtualfs

## Installation

```sh
npm install --save encryptedfs
```

## Usage

```ts
import type { EFSWorkerModule } from 'encryptedfs';

import { WorkerManager } from '@matrixai/workers';
import { EncryptedFS, utils } from 'encryptedfs';

const key = utils.generateKeySync(256);

const efs = await EncryptedFS.createEncryptedFS({
  dbPath: '/tmp/efs',
  dbKey: key,
});

// optionally set up the worker manager for multi-threaded encryption/decryption
const workerManager = await WorkerManager.createWorkerManager<EFSWorkerModule>({
  workerFactory: () => spawn(new Worker('./src/workers/efsWorker'))
});

efs.setWorkerManager(workerManager);

// create a new directory
const newDir = `test`;
await efs.mkdir(newDir);

// write out to a file
await efs.writeFile(`${newDir}/testFile`, 'output');

// read in the file (contents = 'output')
const contents = await efs.readFile(`${newDir}/testFile`);

// closes the EFS
await efs.stop();

// destroys the EFS state
await efs.destroy();
```

### Encryption & Decryption Protocol

Encryption & Decryption implemented using the `node-forge` library. However it is possible to plug in your own `encrypt` and `decrypt` functions.

Internally we use the AES-GCM symmetric encryption using a master `dbKey` that can be 128, 192 or 256 bits long.

The `dbKey` can be generated from several methods:

* `generateKey` - random asynchronous
* `generateKeySync` - random synchronous
* `generateKeyFromPass` - derived from user-provided "password" asynchronous
* `generateKeyFromPassSync` - derived from user-provided "password" synchronous

For example:

```ts
const [key, salt] = await generateKeyFromPass('secure password');
```

This uses PBKDF2 to derive a symmetric key. The default key length will be 256 bits. For deterministic key generation, make sure to specify the `salt` parameter.

```ts
const [key, salt] = await generateKeyFromPass('secure password', 'salt');
```

Construction of `EncryptedFS` relies on an optional `blockSize` parameter. This is by default set to 4 KiB. All files are broken up into 4 KiB plaintext blocks. When encrypted, they are persisted as ciphertext blocks.

The ciphertext blocks contain an initialization vector plus an authorisation tag. Here is an example of the structure:

```
| iv (16 bytes) | authTag (16 bytes) | ciphertext data (x bytes) |
```

The ciphertext data length is equal to the plaintext block length.

### Differences with Node Filesystem

There are some differences between EFS and Node FS:

* User, Group and Other permissions: In EFS User, Group and Other permissions are strictly confined to their permission class. For example, a User in EFS does not have the permissions that a Group or Other has while in Node FS a User also has permissions that Group and Other have.
* Sticky Files: In Node FS, a sticky bit is a permission bit that is set on a file or a directory that lets only the owner of the file/directory or the root user to delete or rename the file. EFS does not support the use of sticky bits.
* Character Devices: Node FS contains Character Devices which can be written to and read from. However, in EFS Character Devices are not supported yet.

## Development

Run `nix-shell`, and once you're inside, you can use:

```sh
# install (or reinstall packages from package.json)
npm install
# build the dist
npm run build
# run the repl (this allows you to import from ./src)
npm run ts-node
# run the tests
npm run test
# lint the source code
npm run lint
# automatically fix the source
npm run lintfix
```

## Benchmarks

```sh
npm run bench
```

View benchmarks here: https://github.com/MatrixAI/js-encryptedfs/blob/master/benches/results with https://raw.githack.com/

### Docs Generation

```sh
npm run docs
```

See the docs at: https://matrixai.github.io/js-encryptedfs/

### Publishing

```sh
# npm login
npm version patch # major/minor/patch
npm run build
npm publish --access public
git push
git push --tags
```
