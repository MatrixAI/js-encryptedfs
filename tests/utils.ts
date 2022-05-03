import type EncryptedFS from '@/EncryptedFS';
import * as constants from '@/constants';

/**
 * Checks if asynchronous operation throws an exception
 */
async function expectError(
  p: Promise<unknown>,
  exception: new (...params: Array<unknown>) => Error = Error,
  errno?: {
    errno?: number;
    code?: string;
    description?: string;
  },
): Promise<void> {
  await expect(p).rejects.toThrow(exception);
  if (errno != null) {
    await expect(p).rejects.toHaveProperty('code', errno.code);
    await expect(p).rejects.toHaveProperty('errno', errno.errno);
    await expect(p).rejects.toHaveProperty('description', errno.description);
  }
}

function expectReason(
  result: PromiseSettledResult<unknown>,
  exception: new (...params: Array<unknown>) => Error = Error,
  errno?: {
    errno?: number;
    code?: string;
    description?: string;
  },
): void {
  expect(result.status).toBe('rejected');
  if (result.status === 'fulfilled') throw Error('never'); // Let typescript know the status
  expect(result.reason).toBeInstanceOf(exception);
  if (errno != null) {
    expect(result.reason).toHaveProperty('code', errno.code);
    expect(result.reason).toHaveProperty('errno', errno.errno);
    expect(result.reason).toHaveProperty('description', errno.description);
  }
}

type FileTypes = 'none' | 'regular' | 'dir' | 'block' | 'symlink';

async function createFile(
  efs: EncryptedFS,
  type: FileTypes,
  name: string,
  a?: number,
  b?: number,
  c?: number,
) {
  switch (type) {
    default:
      throw Error('invalidType: ' + type);
    case 'none':
      return;
    case 'regular':
      await efs.writeFile(name, '', { mode: 0o0644 });
      break;
    case 'dir':
      await efs.mkdir(name, { mode: 0o0755 });
      break;
    case 'block':
      await efs.mknod(name, constants.S_IFREG, 0o0644, 1, 2);
      break;
    case 'symlink':
      await efs.symlink('test', name);
  }
  if (a && b && c) {
    if (type === 'symlink') {
      await efs.lchmod(name, a);
    } else {
      await efs.chmod(name, a);
    }
    await efs.lchown(name, b, c);
  } else if (a && b) {
    await efs.lchown(name, a, b);
  } else if (a) {
    if (type === 'symlink') {
      await efs.lchmod(name, a);
    } else {
      await efs.chmod(name, a);
    }
  }
}

const supportedTypes = [
  'regular' as FileTypes,
  'dir' as FileTypes,
  'block' as FileTypes,
  'symlink' as FileTypes,
];

async function sleep(ms: number) {
  return await new Promise((r) => setTimeout(r, ms));
}

function setId(efs: EncryptedFS, uid: number, gid?: number) {
  efs.uid = uid;
  efs.gid = gid ?? uid;
}

export { expectError, expectReason, createFile, supportedTypes, sleep, setId };

export type { FileTypes };
