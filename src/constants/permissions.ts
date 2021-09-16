import * as constants from './constants';

/**
 * Default root uid.
 */
export const DEFAULT_ROOT_UID = 0;

/**
 * Default root gid.
 */
export const DEFAULT_ROOT_GID = 0;

/**
 * Default root directory permissions of `rwxr-xr-x`.
 */
export const DEFAULT_ROOT_PERM =
  constants.S_IRWXU |
  constants.S_IRGRP |
  constants.S_IXGRP |
  constants.S_IROTH |
  constants.S_IXOTH;

/**
 * Default file permissions of `rw-rw-rw-`.
 */
export const DEFAULT_FILE_PERM =
  constants.S_IRUSR |
  constants.S_IWUSR |
  constants.S_IRGRP |
  constants.S_IWGRP |
  constants.S_IROTH |
  constants.S_IWOTH;

/**
 * Default directory permissions of `rwxrwxrwx`.
 */
export const DEFAULT_DIRECTORY_PERM =
  constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO;

/**
 * Default symlink permissions of `rwxrwxrwx`.
 */
export const DEFAULT_SYMLINK_PERM =
  constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO;

