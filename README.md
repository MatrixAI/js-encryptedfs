# js-encryptedfs

This library provides an Encrypted File System (EFS)

[![pipeline status](https://gitlab.com/MatrixAI/open-source/js-encryptedfs/badges/master/pipeline.svg)](https://gitlab.com/MatrixAI/open-source/js-encryptedfs/commits/master)

## Installation

```sh
npm install --save encryptedfs
```

## Usage

```ts
import EncryptedFS from '@/EncryptedFS';

const efs = await EncryptedFS.createEncryptedFS({key, path});

// create a new directory
const newDir = `test`;
await efs.mkdir(newDir);

// write out to a file
await efs.writeFile(`${newDir}/testFile`, 'output');

// read in the file (contents = 'output')
const contents = await efs.readFile(`${newDir}/testFile`);
```

## Development

Run `nix-shell`, and once you're inside, you can use:

```sh
# install (or reinstall packages from package.json)
npm install
# run the repl (this allows you to import from ./src)
npm run ts-node
# run the tests
npm run test
# lint the source code
npm run lint
# automatically fix the source
npm run lintfix
# build the docs
npm run docs
```

### Publishing

```sh
npm login
npm version patch # major/minor/patch
npm run build
npm publish --access public
git push
git push --tags
```

## Chunks

Chunks consist of a an acutal data 'block' that is encrypted. It is also prepended with the initialization vector and authorisation tag used to encrypt the data.

Below is a diagram showing the layout of the encrypted chunks.
<pre style="white-space:pre !important; overflow-x:scroll !important">
||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
||                       ||                   ||                        ||
|| Initialization Vector || Authorisation Tag || Encrypted Block ... -> ||
||                       ||                   ||                        ||
||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
</pre>

## Blocks

This is a constant sized amount (optionally user-specified) of business data.
A large file is split into several blocks of *block_size* (generall 4k).
This is to to allow random access reads and writies.
For example to read a small section of a file, the entire file does not need to be decrpted
Only the block(s) that contain the section you want to read.
This does mean however, that there needs to be an IV for each block.
This is because reusing IVs, or having predictable IVs is a security threat.

## Segments

Some amount of data equal or smaller than a block.

## Encryption scheme

EFS uses AES-GCM symmetric encryption with a master key that is 16 bytes. This master key can be provided or can be generated using an internal function:

```sh
const masterKey = generateMasterKey('secure password')
```

This function derives a symmetric encryption key using `pbkdf` from `node-forge`. The key generated from this function will be 16 bytes.

An authorisation tag based on chunk encryption is stored along side the init vector. This provides a basic chunk level integrity gurantee that can be verified upon decryption in accordance with the AES-GCM algorithm.

## Functionality

- Keys are never decrypted on disk, they are in fact decrypted in an in-memory file system
- Uses Symmetric Encryption
- Encryption keys are transparent to the user
