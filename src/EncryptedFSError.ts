/**
 * Class representing an encrypted file system error.
 * @extends Error
 */
class EncryptedFSError extends Error {

  errno: number
  code: string
  errnoDescription: string
  syscall?: string

  /**
   * Creates EncryptedFSError.
   */
  constructor(
    errnoObj: { errno: number, code: string, description: string },
    path?: string | null,
    dest?: string | null,
    syscall?: string | null
  ) {
    let message = errnoObj.code + ': ' + errnoObj.description
    if (path != null) {
      message += ', ' + path
      if (dest != null) message += ' -> ' + dest
    }
    super(message)
    this.errno = errnoObj.errno
    this.code = errnoObj.code
    this.errnoDescription = errnoObj.description
    if (syscall != null) {
      this.syscall = syscall
    }
  }

  setPaths(src: string, dst?: string) {
    let message = this.code + ': ' + this.errnoDescription + ', ' + src
    if (dst != null) message += ' -> ' + dst
    this.message = message
    return
  }

  setSyscall(syscall: string) {
    this.syscall = syscall
  }

}

export { EncryptedFSError }
export { code as errno } from 'errno';
