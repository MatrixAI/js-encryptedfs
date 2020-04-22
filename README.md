# Overview
This library provides an Encrypted File System (EFS)
## Chunks
Chunks consist of a an acutal data 'block' with the IV preceding it
## Blocks
This is a constant sized amount (optionally user-specified) of business data.
A large file is split into several block of *block_size* (generall 4k).
This is to to allow random access reads and writies.
For example to read a small section of a file, the entire file does not need to be decrpted
Only the block(s) that contain the section you want to read.
This does mean however, that there needs to be an IV for each block.
This is because reusing IVs, or having predictable IVs is a security threat.
It can lead to the _______ attack. TODO: which attack again?
Perhaps for large executables, where you need to always read the file in its entirely,
We can get rid of the block and IVs. But consider if it's really worth it because you're
only saving kilobytes here.
## Segments
Some amount of data equal or smaller than a block.

## Functionality
- Keys are never decrypted on disk
- Uses Asymmetric and Symmetric Encryption
- Allows choice of algorithm for encryption/decryption


# Getting Started
TODO: Write instructions
## Installation
### Building from source
TODO: Write instructions

# Development
TODO: Write instructions

# Testing
This library uses [Jest](https://jestjs.io/) for testing.

# Operator warnings

---
# TODO
- Move EFS to using fdIndex and an internal file descriptor index
- Decide if we want to use process.chdir(...) for lowerDir cwd or just have a convenience function to turn a relative path (passed to EFS) into an absolute path that we can give to lowerDir
- There is an issue with setUid and getUid on _upperDir (vfs) currently its not behaving predictably, if you are uid and gid 1000 and then set both of these (should be redundantly) to 1000 again, you lose access permissions
- Make sure metadata is written/read correctly (i.e. same position for all operations)