import type EncryptedFS from '@/EncryptedFS';
import { constants } from '@';

/**
 *
 * @param promise - the Promise that throws the expected error.
 * @param code - Error code such as 'errno.ENOTDIR'
 */
async function expectError(promise: Promise<any>, code) {
  await expect(promise).rejects.toThrow();
  await expect(promise).rejects.toHaveProperty('code', code.code);
  await expect(promise).rejects.toHaveProperty('errno', code.errno);
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

export { expectError, createFile, supportedTypes, sleep, setId };

export type { FileTypes };
