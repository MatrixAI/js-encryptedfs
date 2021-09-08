import EncryptedFS from '@/EncryptedFS';
import * as vfs from 'virtualfs';

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

export type fileTypes =
  | 'none'
  | 'regular'
  | 'dir'
  | 'block'
  | 'char'
  | 'symlink';
async function createFile(
  efs: EncryptedFS,
  type: fileTypes,
  name: string,
  a?: number,
  b?: number,
  c?: number,
) {
  switch (type) {
    default:
      fail('invalidType: ' + type);
    case 'none':
      return;
    case 'regular':
      await efs.writeFile(name, '', { mode: 0o0644 });
      break;
    case 'dir':
      await efs.mkdir(name, 0o0755);
      break;
    case 'block':
      await efs.mknod(name, vfs.constants.S_IFREG, 0o0644, 1, 2);
      break;
    case 'char':
      await efs.mknod(name, vfs.constants.S_IFCHR, 0o0644, 1, 2);
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
  'regular' as fileTypes,
  'dir' as fileTypes,
  'block' as fileTypes,
  'char' as fileTypes,
  'symlink' as fileTypes,
];

async function sleep(ms: number) {
  return await new Promise((r) => setTimeout(r, ms));
}

function setId(efs: EncryptedFS, uid: number, gid?: number) {
  efs.uid = uid;
  efs.gid = gid ?? uid;
}

export { expectError, createFile, supportedTypes, sleep, setId };
