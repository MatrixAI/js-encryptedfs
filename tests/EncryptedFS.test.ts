import fs, { Stats } from 'fs';
import os from 'os';
import * as crypto from 'crypto';
import path from 'path';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import EncryptedFS from '@/EncryptedFS';
import * as utils from '@/util';
import { WorkerManager } from '@/workers';

// js imports
const vfs = require('virtualfs');

describe('EncryptedFS class', () => {
  let dataDir: string;
  let key: Buffer;
  const logger = new Logger('EncryptedFS Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);

  beforeEach(async () => {
    key = utils.getRandomBytesSync(16);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'encryptedfs-test-'));
  });
  afterEach(async () => {
    fs.rmdirSync(dataDir, {
      recursive: true,
    });
  });

  test('initialisation', () => {
    const vfsInstance = new vfs.VirtualFS();
    const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
    expect(efs).toBeInstanceOf(EncryptedFS);
  });

  test('various failure situations - sync', () => {
    const vfsInstance = new vfs.VirtualFS();
    const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
    efs.mkdirSync(`test/dir`, { recursive: true });
    efs.writeFileSync(`test/file`, 'Hello');

    expect(() => {
      efs.writeFileSync(`test/dir`, 'Hello');
    }).toThrow();
    expect(() => {
      efs.writeFileSync(``, 'Hello');
    }).toThrow();
    expect(() => {
      efs.rmdirSync(``);
    }).toThrow();
    expect(() => {
      efs.unlinkSync(``);
    }).toThrow();
    expect(() => {
      efs.mkdirSync(`test/dir`);
    }).toThrow();
    expect(() => {
      efs.mkdirSync(`test/file`);
    }).toThrow();
    expect(() => {
      efs.mkdirSync(`test/file`, { recursive: true });
    }).toThrow();
    expect(() => {
      efs.readdirSync(`test/file`);
    }).toThrow();
    expect(() => {
      efs.readlinkSync(`test/dir`, {});
    }).toThrow();
    expect(() => {
      efs.readlinkSync(`test/file`, {});
    }).toThrow();
  });

  test('asynchronous errors are passed to callbacks - async', () => {
    const vfsInstance = new vfs.VirtualFS();
    const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
    expect(async () => {
      await efs.promises.readFile('/nonexistent/');
      await efs.promises.writeFile('/fail/file', '', {});
      await efs.promises.mkdir('/cannot/do/this');
      await efs.promises.readlink('/nolink', {});
    }).rejects.toThrow();
  });

  ///////////////
  // stat type //
  ///////////////

  test('file stat makes sense - sync', () => {
    const vfsInstance = new vfs.VirtualFS();
    const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
    efs.writeFileSync(`test`, 'test data');
    const stat = efs.statSync(`test`);
    expect(stat.isFile()).toStrictEqual(true);
    expect(stat.isDirectory()).toStrictEqual(false);
    expect(stat.isBlockDevice()).toStrictEqual(false);
    expect(stat.isCharacterDevice()).toStrictEqual(false);
    expect(stat.isSocket()).toStrictEqual(false);
    expect(stat.isSymbolicLink()).toStrictEqual(false);
    expect(stat.isFIFO()).toStrictEqual(false);
  });

  test('dir stat makes sense - sync', () => {
    const vfsInstance = new vfs.VirtualFS();
    const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
    efs.mkdirSync(`dir`);
    const stat = efs.statSync(`dir`);
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(true);
    expect(stat.isBlockDevice()).toStrictEqual(false);
    expect(stat.isCharacterDevice()).toStrictEqual(false);
    expect(stat.isSocket()).toStrictEqual(false);
    expect(stat.isSymbolicLink()).toStrictEqual(false);
    expect(stat.isFIFO()).toStrictEqual(false);
  });

  test('symlink stat makes sense - sync', () => {
    const vfsInstance = new vfs.VirtualFS();
    const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
    efs.writeFileSync(`a`, 'data');
    efs.symlinkSync(`a`, `link-to-a`);
    const stat = efs.lstatSync(`link-to-a`);
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(false);
    expect(stat.isBlockDevice()).toStrictEqual(false);
    expect(stat.isCharacterDevice()).toStrictEqual(false);
    expect(stat.isSocket()).toStrictEqual(false);
    expect(stat.isSymbolicLink()).toStrictEqual(true);
    expect(stat.isFIFO()).toStrictEqual(false);
  });

  ///////////
  // files //
  ///////////

  test('can make and remove files - sync', () => {
    const vfsInstance = new vfs.VirtualFS();
    const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
    const buffer = Buffer.from('Hello World', 'utf8');
    efs.writeFileSync(`hello-world`, buffer);

    expect(efs.readFileSync(`hello-world`, {})).toEqual(buffer);

    expect(efs.readFileSync(`hello-world`, { encoding: 'utf8' })).toBe(
      'Hello World',
    );

    efs.writeFileSync(`a`, 'Test', { encoding: 'utf-8' });
    expect(efs.readFileSync(`a`, { encoding: 'utf-8' })).toBe('Test');

    const stat = efs.statSync(`a`);
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
    expect(stat.isDirectory()).toBe(false);

    efs.writeFileSync(`b`, 'Test', { encoding: 'utf8' });
    expect(efs.readFileSync(`b`, { encoding: 'utf-8' })).toEqual('Test');
    expect(() => {
      expect(efs.readFileSync(`other-file`, {})).toThrow();
    }).toThrow();
    expect(() => {
      expect(efs.readFileSync(`other-file`, { encoding: 'utf8' })).toThrow();
    }).toThrow();
  });

  test('can make many files - sync', () => {
    const vfsInstance = new vfs.VirtualFS();
    const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
    for (let i = 0; i < 60; i++) {
      const name = 'secret ' + i.toString();
      const content = Buffer.from(name);
      efs.writeFileSync(name, content, {});
      const files = efs.readFileSync(name);

      expect(files).toStrictEqual(content);
    }
  });

  test('can write a large file - sync', () => {
    const vfsInstance = new vfs.VirtualFS();
    const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
    let content = '';
    for (let i = 0; i < 100; i++) {
      const name = 'secret';
      content += name + i.toString();
      efs.writeFileSync(name, Buffer.from(content), {});
      const files = efs.readFileSync(name);

      expect(files).toStrictEqual(Buffer.from(content));
    }
  });

  /////////////////
  // directories //
  /////////////////

  describe('directories', () => {
    test('has an empty root directory at startup - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      expect(efs.readdirSync(``)).toEqual([]);
      const stat = efs.statSync('');
      expect(stat.isFile()).toStrictEqual(false);
      expect(stat.isDirectory()).toStrictEqual(true);
      expect(stat.isSymbolicLink()).toStrictEqual(false);
    });

    test('has an empty root directory at startup - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.promises.readdir(``).then((list) => {
        expect(list).toEqual([]);
        efs.promises
          .stat(``)
          .then((stat) => {
            expect(stat.isFile()).toStrictEqual(false);
            expect(stat.isDirectory()).toStrictEqual(true);
            expect(stat.isSymbolicLink()).toStrictEqual(false);
            done();
          })
          .catch((err) => {
            expect(err).toBeNull();
          });
      });
    });

    test('is able to make directories - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`first`, { recursive: true });
      efs.mkdirSync(`first//sub/`, { recursive: true });
      efs.mkdirSync(`first/sub/subsub`);
      efs.mkdirSync(`first/sub2`, { recursive: true });
      efs.mkdirSync(`backslash\\dir`);
      expect(efs.readdirSync(``)).toEqual(['backslash\\dir', 'first']);
      expect(efs.readdirSync(`first/`)).toEqual(['sub', 'sub2']);
      efs.mkdirSync(`a/depth/sub/dir`, { recursive: true });
      expect(efs.existsSync(`a/depth/sub`)).toStrictEqual(true);
      const stat = efs.statSync(`a/depth/sub`);
      expect(stat.isFile()).toStrictEqual(false);
      expect(stat.isDirectory()).toStrictEqual(true);
    });

    test('is able to make directories - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.promises.mkdir(`first`).then(() => {
        efs.promises.mkdir(`first//sub/`).then(() => {
          efs.promises.mkdir(`first/sub2/`).then(() => {
            efs.promises
              .mkdir(`backslash\\dir`, { recursive: true })
              .then(() => {
                efs.promises.readdir(``).then((list) => {
                  expect(list).toEqual(['backslash\\dir', 'first']);
                  efs.promises.readdir(`first/`).then((list) => {
                    expect(list).toEqual(['sub', 'sub2']);
                    efs.promises
                      .mkdir(`a/depth/sub/dir`, { recursive: true })
                      .then(() => {
                        efs.promises.stat(`a/depth/sub`).then((stat) => {
                          expect(stat.isFile()).toEqual(false);
                          expect(stat.isDirectory()).toEqual(true);
                          done();
                        });
                      });
                  });
                });
              });
          });
        });
      });
    });

    test('should not make the root directory - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      expect(() => {
        efs.mkdirSync('/');
      }).toThrow('EEXIST');
    });

    test('should be able to navigate before root - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const buffer = Buffer.from('Hello World');
      efs.mkdirSync(`first`);
      efs.writeFileSync(`hello-world.txt`, buffer);
      let stat;
      stat = efs.statSync(`first/../../../../../../first`);
      expect(stat.isFile()).toStrictEqual(false);
      expect(stat.isDirectory()).toStrictEqual(true);
      stat = efs.statSync(`first/../../../../../../hello-world.txt`);
      expect(stat.isFile()).toStrictEqual(true);
      expect(stat.isDirectory()).toStrictEqual(false);
    });

    test('should be able to remove directories - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`first`);
      efs.mkdirSync(`first//sub/`);
      efs.mkdirSync(`first/sub2`);
      efs.mkdirSync(`backslash\\dir`);
      efs.rmdirSync(`first/sub//`);
      const firstlist = efs.readdirSync(`/first`);
      expect(firstlist).toEqual(['sub2']);
      efs.rmdirSync(`first/sub2`);
      efs.rmdirSync(`first`);
      const exists = efs.existsSync(`first`);
      expect(exists).toEqual(false);
      expect(() => {
        efs.accessSync(`first`);
      }).toThrow('ENOENT');
      expect(() => {
        efs.readdirSync(`first`);
      }).toThrow('ENOENT');
      const rootlist = efs.readdirSync(``);
      expect(rootlist).toEqual(['backslash\\dir']);
    });

    test('rmdir does not traverse the last symlink', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`directory`);
      efs.symlinkSync(`directory`, `linktodirectory`);
      expect(() => {
        efs.rmdirSync(`linktodirectory`);
      }).toThrow('ENOTDIR');
      efs.unlinkSync('linktodirectory');
    });

    test('creating temporary directories - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const tempSubDir = `dir`;
      efs.mkdirSync(tempSubDir);
      const buffer = Buffer.from('abc');
      efs.writeFileSync(`${tempSubDir}/test`, buffer);
      expect(
        efs.readFileSync(`${tempSubDir}/test`, { encoding: 'utf8' }),
      ).toEqual(buffer.toString());
    });

    test('trailing slash refers to the directory instead of a file - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.writeFileSync(`abc`, '');
      expect(() => {
        efs.accessSync(`abc/`, undefined);
      }).toThrow('ENOTDIR');
      expect(() => {
        efs.accessSync(`abc/.`, undefined);
      }).toThrow('ENOTDIR');
      expect(() => {
        efs.mkdirSync(`abc/.`);
      }).toThrow('ENOTDIR');
      expect(() => {
        efs.mkdirSync(`abc/`);
      }).toThrow('EEXIST');
    });

    test('trailing slash works for non-existent directories when intending to create them - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`abc/`);
      const stat = efs.statSync(`abc/`);
      expect(stat.isDirectory()).toStrictEqual(true);
    });

    test('trailing `/.` for mkdirSync should result in errors', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      expect(() => {
        efs.mkdirSync(`abc/.`);
      }).toThrow('ENOENT');
      efs.mkdirSync(`abc`);
      expect(() => {
        efs.mkdirSync(`abc/.`);
      }).toThrow('EEXIST');
    });

    test('trailing `/.` for a recursive mkdirSync should not result in any errors', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`abc/.`, { recursive: true });
      const stat = efs.statSync(`abc`);
      expect(stat.isDirectory()).toStrictEqual(true);
    });
  });

  ///////////////
  // hardlinks //
  ///////////////

  describe('hardlinks', () => {
    test('multiple hardlinks to the same file - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`test`);
      efs.writeFileSync(`test/a`, '');
      efs.linkSync(`test/a`, `test/b`);
      const inoA = efs.statSync(`test/a`).ino;
      const inoB = efs.statSync(`test/b`).ino;
      expect(inoA).toEqual(inoB);
      expect(efs.readFileSync(`test/a`, {})).toEqual(
        efs.readFileSync(`test/b`, {}),
      );
    });

    test('should not create hardlinks to directories - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`test`);

      expect(() => {
        efs.linkSync(`test`, `hardlinkttotest`);
      }).toThrow('EPERM');
    });
  });

  //////////////
  // symlinks //
  //////////////

  describe('symlinks', () => {
    test('symlink paths can contain multiple slashes', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`dir`);
      efs.writeFileSync(`dir/test`, 'hello');
      efs.symlinkSync(`///dir////test`, `linktodirtest`);
      expect(efs.readFileSync(`dir/test`, {})).toEqual(
        efs.readFileSync(`linktodirtest`, {}),
      );
      efs.unlinkSync('linktodirtest');
    });

    test('resolves symlink loops 1 - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.symlinkSync(`test`, `test`);

      expect(() => {
        efs.readFileSync(`test`, {});
      }).toThrow('ELOOP');
      efs.unlinkSync('test');
    });

    test('is able to add and traverse symlinks transitively - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`test`);
      const buffer = Buffer.from('Hello World');
      efs.writeFileSync(`test/hello-world.txt`, buffer);
      efs.symlinkSync(`test`, `linktotestdir`, 'dir');
      expect(efs.readlinkSync(`linktotestdir`, {})).toEqual(`//test`);
      expect(efs.readdirSync(`linktotestdir`)).toEqual(['hello-world.txt']);
      efs.symlinkSync(`linktotestdir/hello-world.txt`, `linktofile`);
      efs.symlinkSync(`linktofile`, `linktolink`);
      expect(efs.readFileSync(`linktofile`, { encoding: 'utf-8' })).toEqual(
        'Hello World',
      );
      expect(efs.readFileSync(`linktolink`, { encoding: 'utf-8' })).toEqual(
        'Hello World',
      );
      efs.unlinkSync('linktolink');
      efs.unlinkSync('linktofile');
      efs.unlinkSync('linktotestdir');
    });

    test('unlink does not traverse symlinks - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`test`);
      const buffer = Buffer.from('Hello World');
      efs.writeFileSync(`test/hello-world.txt`, buffer);
      efs.symlinkSync(`test`, `linktotestdir`, 'dir');
      efs.symlinkSync(`linktotestdir/hello-world.txt`, `linktofile`);
      efs.unlinkSync(`linktofile`);
      efs.unlinkSync(`linktotestdir`);
      expect(efs.readdirSync(`test`)).toEqual(['hello-world.txt']);
    });
  });

  /////////////
  // streams //
  /////////////

  describe('streams', () => {
    test('readstream options start and end are both inclusive - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello';
      efs.writeFileSync(`test`, str);
      const readable = efs.createReadStream(`test`, {
        encoding: 'utf8',
        start: 0,
        end: str.length - 1,
      });
      expect.assertions(1);
      readable.on('readable', () => {
        const readStr = readable.read();
        if (readStr) {
          expect(readStr.slice(0, str.length)).toEqual(str);
          done();
        }
      });
    });
    test('readstreams respect start and end options - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello';
      efs.writeFileSync(`file`, str, { encoding: 'utf8' });
      const readable = efs.createReadStream(`file`, {
        encoding: 'utf8',
        start: 1,
        end: 4,
      });
      readable.on('readable', () => {
        const readStr = readable.read();
        if (readStr) {
          expect(readStr.slice(0, str.length)).toEqual(str.slice(1, 4));
          done();
        }
      });
    });
    test('readstream respects the start option - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello';
      const filePath = `file`;
      efs.writeFileSync(filePath, str, { encoding: 'utf8' });
      const readable = efs.createReadStream(filePath, {
        encoding: 'utf8',
        start: 0,
        end: str.length,
      });
      expect.assertions(1);
      readable.on('readable', () => {
        const readStr = readable.read();
        if (readStr) {
          expect(readStr.slice(0, str.length)).toEqual(
            str.slice(0, str.length),
          );
          done();
        }
      });
    });
    test('readstream end option is ignored without the start option - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello';
      const filePath = `file`;
      efs.writeFileSync(filePath, str);
      const readable = efs.createReadStream(filePath, {
        encoding: 'utf8',
        end: str.length,
      });
      expect.assertions(1);
      readable.on('readable', () => {
        const readStr = readable.read();
        if (readStr) {
          expect(readStr.slice(0, str.length)).toEqual(
            str.slice(0, str.length),
          );
          done();
        }
      });
    });
    test('readstream can use a file descriptor - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello';
      const filePath = `file`;
      efs.writeFileSync(filePath, str);
      const fd = efs.openSync(filePath, 'r');
      const readable = efs.createReadStream('', {
        encoding: 'utf8',
        fd: fd,
        end: str.length,
      });
      expect.assertions(1);
      readable.on('readable', () => {
        const readStr = readable.read();
        if (readStr) {
          expect(readStr.slice(0, str.length)).toEqual(
            str.slice(0, str.length),
          );
          done();
        }
      });
    });
    test('readstream with start option overrides the file descriptor position - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello';
      efs.writeFileSync(`file`, str);
      const fd = efs.openSync(`file`, 'r');
      const offset = 1;
      const readable = efs.createReadStream('', {
        encoding: 'utf8',
        fd: fd,
        start: offset,
        end: 4,
      });
      readable.on('readable', () => {
        const readStr = readable.read();
        if (readStr) {
          expect(readStr).toEqual(str.slice(offset, 4));
          done();
        }
      });
    });
    test('readstreams handle errors asynchronously - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const stream = efs.createReadStream(`file`, {});
      stream.on('error', (e) => {
        expect(e.message).toContain('ENOENT');
        done();
      });
      stream.read(10);
    });
    test('readstreams can compose with pipes - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello';
      efs.writeFileSync(`file`, str);
      expect.assertions(1);
      const readStream = efs.createReadStream(`file`, {
        encoding: 'utf8',
        end: 10,
      });
      readStream.on('data', (data) => {
        expect(data.toString('utf8').slice(0, str.length)).toEqual(
          str.slice(0, str.length),
        );
        done();
      });
    });
    test('writestream can create and truncate files - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello';
      const fileName = `file`;
      expect.assertions(2);
      efs.createWriteStream(fileName, {}).end(str, () => {
        const readStr = efs.readFileSync(fileName, { encoding: 'utf-8' });
        expect(readStr).toEqual(str);
        efs.createWriteStream(fileName, {}).end('', () => {
          expect(efs.readFileSync(fileName, { encoding: 'utf-8' })).toEqual('');
          done();
        });
      });
    });
    test('writestream can be piped into - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello';
      expect.assertions(1);
      const stream = efs.createWriteStream(`file`, {});
      stream.write(Buffer.from(str));
      stream.end();
      stream.on('finish', () => {
        expect(efs.readFileSync(`file`, { encoding: 'utf-8' })).toEqual(str);
        done();
      });
    });
    test('writestreams handle errors asynchronously - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const fileName = `file/unknown`;
      const writable = efs.createWriteStream(fileName, {});
      // note that it is possible to have the finish event occur before the error event
      expect.assertions(2);
      writable.once('error', (e) => {
        expect(e).not.toBeNull();
        expect(e.toString()).toContain('ENOENT');
        done();
      });
      writable.end();
    });
    test('writestreams allow ignoring of the drain event, temporarily ignoring resource usage control - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const waterMark = 10;
      const fileName = `file`;
      const writable = efs.createWriteStream(fileName, {
        highWaterMark: waterMark,
      });
      const buffer = Buffer.allocUnsafe(waterMark).fill(97);
      const times = 4;
      for (let i = 0; i < times; ++i) {
        expect(writable.write(buffer)).toEqual(false);
      }
      writable.end(() => {
        const readBuffer = efs.readFileSync(fileName, { encoding: 'utf-8' });
        expect(readBuffer).toEqual(buffer.toString().repeat(times));
        done();
      });
    });
    test('writestreams can use the drain event to manage resource control - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const waterMark = 10;
      const fileName = `file`;
      const writable = efs.createWriteStream(fileName, {
        highWaterMark: waterMark,
      });
      const buf = Buffer.allocUnsafe(waterMark).fill(97);
      let times = 10;
      const timesOrig = times;
      const writing = () => {
        let status: boolean;
        do {
          status = writable.write(buf);
          times -= 1;
          if (times === 0) {
            writable.end(() => {
              expect(efs.readFileSync(fileName, { encoding: 'utf8' })).toEqual(
                buf.toString().repeat(timesOrig),
              );
              done();
            });
          }
        } while (times > 0 && status);
        if (times > 0) {
          writable.once('drain', writing);
        }
      };
      writing();
    });
  });

  ///////////////////////
  // stat time changes //
  ///////////////////////

  describe('stat time changes', () => {
    test('truncate and ftruncate will change mtime and ctime - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'abcdef';
      efs.writeFileSync(`test`, str);
      const stat = efs.statSync(`test`);
      setTimeout(() => {
        efs.truncateSync(`test`, str.length);
        const stat2 = efs.statSync(`test`);
        expect(stat.mtime < stat2.mtime && stat.ctime < stat2.ctime).toEqual(
          true,
        );
        setTimeout(() => {
          const fd = efs.openSync(`test`, 'r+');
          efs.ftruncateSync(fd, str.length);
          const stat3 = efs.statSync(`test`);
          expect(
            stat2.mtime < stat3.mtime && stat2.ctime < stat3.ctime,
          ).toEqual(true);
          setTimeout(() => {
            efs.ftruncateSync(fd, str.length);
            const stat4 = efs.statSync(`test`);
            expect(
              stat3.mtime < stat4.mtime && stat3.ctime < stat4.ctime,
            ).toEqual(true);
            efs.closeSync(fd);
            done();
          }, 10);
        }, 10);
      }, 10);
    });

    test('fallocate will only change ctime - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const fd = efs.openSync(`allocate`, 'w');
      efs.writeSync(fd, Buffer.from('abc'));
      const stat = efs.statSync(`allocate`);
      const offset = 0;
      const length = 8000;
      efs.fallocate(fd, offset, length, (err) => {
        expect(err).toBeNull();
        const stat2 = efs.statSync(`allocate`);
        expect(stat2.size).toEqual(offset + length);
        expect(stat2.ctime > stat.ctime).toEqual(true);
        expect(stat2.mtime === stat.mtime).toEqual(true);
        expect(stat2.atime === stat.atime).toEqual(true);
        efs.closeSync(fd);
        done();
      });
    });
  });

  ////////////////////////////////
  // directory file descriptors //
  ////////////////////////////////
  describe('directory file descriptors', () => {
    test('directory file descriptors capabilities - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const dirName = `dir`;
      efs.mkdirSync(dirName);
      const dirfd = efs.openSync(dirName, 'r');
      efs.fsyncSync(dirfd);
      efs.fdatasyncSync(dirfd);
      efs.fchmodSync(dirfd, 0o666);
      efs.fchownSync(dirfd, 0, 0);
      const date = new Date();
      efs.futimesSync(dirfd, date, date);
      const stats: Stats = efs.fstatSync(dirfd);
      expect(stats.atime).toEqual(date);
      expect(stats.mtime).toEqual(date);
      efs.closeSync(dirfd);
      done();
    });

    test('directory file descriptor errors - sync', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const dirName = `dir`;
      efs.mkdirSync(dirName);

      // opening it without fs.constants.O_RDONLY would result in EISDIR
      const dirfd = efs.openSync(
        dirName,
        undefined,
        efs.constants.O_RDONLY | efs.constants.O_DIRECTORY,
      );
      const buffer = Buffer.alloc(10);

      expect(() => {
        efs.ftruncateSync(dirfd);
      }).toThrow('EINVAL');
      expect(() => {
        efs.readSync(dirfd, buffer, 0, 10);
      }).toThrow('EISDIR');
      expect(() => {
        efs.writeSync(dirfd, buffer);
      }).toThrow('EISDIR');
      expect(() => {
        efs.readFileSync(dirfd, {});
      }).toThrow('EISDIR');
      expect(() => {
        efs.writeFileSync(dirfd, `test`);
      }).toThrow('EISDIR');

      efs.closeSync(dirfd);
      done();
    });

    test('directory file descriptors inode nlink becomes 0 after deletion of the directory', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const dirName = `dir`;
      efs.mkdirSync(dirName);
      const fd = efs.openSync(dirName, 'r');
      efs.rmdirSync(dirName);
      const stat = efs.fstatSync(fd);
      expect(stat.nlink).toEqual(1);
      efs.closeSync(fd);
      done();
    });
  });

  //////////////////////////////////////////////////////////////////////////
  // function calling styles (involving intermediate optional parameters) //
  //////////////////////////////////////////////////////////////////////////
  describe('function calling styles', () => {
    test('openSync calling styles work - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      expect(() => {
        let fd: number;
        fd = efs.openSync(`test`, 'w+');
        efs.closeSync(fd);
        fd = efs.openSync(`test2`, 'w+', 0o666);
        efs.closeSync(fd);
      }).not.toThrow();
    });

    test('open calling styles work - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.promises
        .open(`test`, 'w+')
        .then((fd) => {
          efs.closeSync(fd!);
          efs.promises
            .open(`test2`, 'w+', 0o666)
            .then((fd) => {
              efs.promises
                .close(fd!)
                .then(() => {
                  done();
                })
                .catch((err) => {
                  expect(err).toBeNull();
                });
            })
            .catch((err) => {
              expect(err).toBeNull();
            });
        })
        .catch((err) => {
          expect(err).toBeNull();
        });
    });

    test('readSync calling styles work - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello World';
      const buf = Buffer.from(str).fill(0);
      efs.writeFileSync(`test`, str);
      const fd = efs.openSync(`test`, 'r+');
      let bytesRead: number;
      bytesRead = efs.readSync(fd, buf);
      expect(bytesRead).toEqual(buf.length);
      bytesRead = efs.readSync(fd, buf, 0);
      expect(bytesRead).toEqual(buf.length);
      bytesRead = efs.readSync(fd, buf, 0, 0);
      expect(bytesRead).toEqual(0);
      bytesRead = efs.readSync(fd, buf, 0, 1);
      expect(bytesRead).toEqual(1);
      bytesRead = efs.readSync(fd, buf, 0, 0);
      expect(bytesRead).toEqual(0);
      bytesRead = efs.readSync(fd, buf, 0, 1);
      expect(bytesRead).toEqual(1);
      efs.closeSync(fd);
    });

    test('read calling styles work - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      // fs.read does not have intermediate optional parameters
      const str = 'Hello World';
      const buf = Buffer.from(str).fill(0);
      efs.writeFileSync(`test`, str);
      const fd = efs.openSync(`test`, 'r+');
      const readBuf = Buffer.allocUnsafe(buf.length);
      efs.promises
        .read(fd, readBuf, 0, buf.length)
        .then((bytesRead) => {
          expect(readBuf.toString().slice(0, str.length)).toEqual(str);
          expect(bytesRead).toEqual(Buffer.from(str).length);
          efs.closeSync(fd);
          done();
        })
        .catch((err) => {
          expect(err).toBeNull();
        });
    });

    test('writeSync calling styles work - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const fd = efs.openSync(`test`, 'w');
      const str = 'Hello World';
      const buf = Buffer.from(str);
      let bytesWritten;
      bytesWritten = efs.writeSync(fd, buf);
      expect(bytesWritten).toEqual(11);
      bytesWritten = efs.writeSync(fd, buf, 0);
      expect(bytesWritten).toEqual(11);
      efs.writeSync(fd, buf, 0, buf.length);
      efs.writeSync(fd, buf, 0, buf.length);
      efs.writeFileSync(fd, str);
      efs.writeFileSync(fd, str);
      efs.writeFileSync(fd, str);
      efs.closeSync(fd);
      // expect(efs.readFileSync(`test`, {encoding: 'utf-8'})).toEqual(str.repeat(7))
    });

    test('write calling styles work - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      // fs.write has intermediate optional parameters
      const fd = efs.openSync(`test`, 'w+');
      const str = 'Hello World';
      const buf = Buffer.from(str);
      efs.promises
        .write(fd, buf)
        .then((bytesWritten) => {
          expect(bytesWritten).toEqual(buf.length);
          const readBuf = Buffer.allocUnsafe(buf.length);
          efs.readSync(fd, readBuf);
          expect(readBuf).toEqual(buf);
          efs.promises
            .write(fd, buf)
            .then((bytesWritten) => {
              expect(bytesWritten).toEqual(buf.length);
              const readBuf = Buffer.allocUnsafe(buf.length);
              efs.readSync(fd, readBuf);
              expect(readBuf).toEqual(buf);
              efs.promises
                .write(fd, buf, undefined, buf.length)
                .then((bytesWritten) => {
                  expect(bytesWritten).toEqual(buf.length);
                  const readBuf = Buffer.allocUnsafe(buf.length);
                  efs.readSync(fd, readBuf);
                  expect(readBuf).toEqual(buf);
                  efs.promises
                    .write(fd, buf, undefined, buf.length)
                    .then((bytesWritten) => {
                      expect(bytesWritten).toEqual(buf.length);
                      const readBuf = Buffer.allocUnsafe(buf.length);
                      efs.readSync(fd, readBuf);
                      expect(readBuf).toEqual(buf);
                      efs.promises
                        .writeFile(fd, str, {})
                        .then(() => {
                          const readBuf = Buffer.allocUnsafe(buf.length);
                          efs.readSync(fd, readBuf);
                          expect(readBuf).toEqual(buf);
                          efs.promises
                            .writeFile(fd, str, {})
                            .then(() => {
                              const readBuf = Buffer.allocUnsafe(buf.length);
                              efs.readSync(fd, readBuf);
                              expect(readBuf).toEqual(buf);
                              efs.promises
                                .writeFile(fd, str, {})
                                .then(() => {
                                  const readBuf = Buffer.allocUnsafe(
                                    buf.length,
                                  );
                                  efs.readSync(fd, readBuf);
                                  expect(readBuf).toEqual(buf);
                                  efs.closeSync(fd);
                                  done();
                                })
                                .catch((err) => {
                                  expect(err).toBeNull();
                                });
                            })
                            .catch((err) => {
                              expect(err).toBeNull();
                            });
                        })
                        .catch((err) => {
                          expect(err).toBeNull();
                        });
                    })
                    .catch((err) => {
                      expect(err).toBeNull();
                    });
                })
                .catch((err) => {
                  expect(err).toBeNull();
                });
            })
            .catch((err) => {
              expect(err).toBeNull();
            });
        })
        .catch((err) => {
          expect(err).toBeNull();
        });
    });

    test('readFileSync calling styles work - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello World';
      const buf = Buffer.from(str);
      efs.writeFileSync(`test`, buf);
      const fd = efs.openSync(`test`, 'r+');
      let contents: Buffer | string;
      contents = efs.readFileSync(`test`, {});
      expect(contents).toEqual(buf);
      contents = efs.readFileSync(`test`, {
        encoding: 'utf8',
        flag: 'r',
      });
      expect(contents).toEqual(str);
      efs.closeSync(fd);
    });

    test('readFile calling styles work - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'Hello World';
      const buf = Buffer.from(str);
      efs.writeFileSync(`test`, buf);
      const fd = efs.openSync(`test`, 'r+');
      efs.promises.readFile(`test`, {}).then((data) => {
        expect(data).toEqual(buf);
        efs.promises
          .readFile(`test`, { encoding: 'utf8', flag: 'r' })
          .then((buffer) => {
            expect(buffer.toString()).toEqual(str);
            efs.promises.readFile(fd).then((buffer) => {
              expect(buffer).toEqual(buf);
              done();
            });
          });
      });
    });

    test('writeFileSync calling styles work - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const fd = efs.openSync(`test`, 'w+');
      const str = 'Hello World';
      const buf = Buffer.from(str);
      efs.writeFileSync(`test`, str);
      expect(efs.readFileSync(`test`, {})).toEqual(buf);
      efs.writeFileSync(`test`, str, {
        encoding: 'utf8',
        mode: 0o666,
        flag: 'w',
      });
      expect(efs.readFileSync(`test`, {})).toEqual(buf);
      efs.writeFileSync(`test`, buf);
      expect(efs.readFileSync(`test`, {})).toEqual(buf);
      efs.writeFileSync(fd, str);
      expect(efs.readFileSync(`test`, {})).toEqual(buf);
      efs.writeFileSync(fd, str, { encoding: 'utf8', mode: 0o666, flag: 'w' });
      expect(efs.readFileSync(`test`, {})).toEqual(buf);
      efs.writeFileSync(fd, buf);
      expect(efs.readFileSync(`test`, {})).toEqual(buf);
      efs.closeSync(fd);
    });

    test('writeFile calling styles work - async', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const fd = efs.openSync(`test`, 'w+');
      const str = 'Hello World';
      const buf = Buffer.from(str);
      efs.promises.writeFile(`test`, str, {}).then(() => {
        efs.promises
          .writeFile(`test`, str, {
            encoding: 'utf8',
            mode: 0o666,
            flag: 'w',
          })
          .then(() => {
            efs.promises
              .writeFile(`test`, buf, {})
              .then(() => {
                efs.promises
                  .writeFile(fd, str, {})
                  .then(() => {
                    efs.promises
                      .writeFile(fd, str, {
                        encoding: 'utf8',
                        mode: 0o666,
                        flag: 'w',
                      })
                      .then(() => {
                        efs.promises
                          .writeFile(fd, buf, {})
                          .then(() => {
                            efs.closeSync(fd);
                            done();
                          })
                          .catch((err) => {
                            expect(err).toBeNull();
                          });
                      })
                      .catch((err) => {
                        expect(err).toBeNull();
                      })
                      .catch((err) => {
                        expect(err).toBeNull();
                      });
                  })
                  .catch((err) => {
                    expect(err).toBeNull();
                  });
              })
              .catch((err) => {
                expect(err).toBeNull();
              });
          })
          .catch((err) => {
            expect(err).toBeNull();
          });
      });
    });
  });

  /////////////////
  // permissions //
  /////////////////
  describe('permissions', () => {
    test('chown changes uid and gid - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`test`, { recursive: true });
      efs.chownSync(`test`, 1000, 1000);
      const stat = efs.statSync(`test`);
      expect(stat.uid).toEqual(1000);
      expect(stat.gid).toEqual(1000);
    });

    test('chmod with 0 wipes out all permissions - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.writeFileSync(`a`, 'abc');
      efs.chmodSync(`a`, 0o000);
      const stat = efs.statSync(`a`);
      expect(stat.mode).toEqual(efs.constants.S_IFREG);
    });

    test('mkdir and chmod affects the mode - promises', (done) => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.promises.mkdir(`test`, { mode: 0o644 }).then(() => {
        efs.accessSync(
          `test`,
          efs.constants.F_OK | efs.constants.R_OK | efs.constants.W_OK,
        );
        efs.promises.chmod(`test`, 0o444).then(() => {
          efs.accessSync(`test`, efs.constants.F_OK | efs.constants.R_OK);
          done();
        });
      });
    });

    test('file permissions rw- - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.writeFileSync(`file`, 'world');
      efs.chmodSync(`file`, 0o600);

      expect(() => {
        efs.accessSync(`file`, efs.constants.X_OK);
      }).toThrow('EACCES');

      const str = 'hello';
      efs.writeFileSync(`file`, str);
      expect(efs.readFileSync(`file`, { encoding: 'utf8' })).toEqual(str);
    });

    test('file permissions rwx - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.writeFileSync(`file`, 'world');
      efs.chmodSync(`file`, 0o700);
      efs.accessSync(`file`, efs.constants.X_OK);
      const str = 'hello';
      efs.writeFileSync(`file`, str);
      expect(efs.readFileSync(`file`, { encoding: 'utf8' })).toEqual(str);
    });

    test('file permissions r-x - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'hello';
      efs.writeFileSync(`file`, str);
      efs.chmodSync(`file`, 0o500);
      efs.accessSync(`file`, efs.constants.X_OK);
      expect(efs.readFileSync(`file`, { encoding: 'utf8' })).toEqual(str);
    });

    test('directory permissions rwx - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      efs.mkdirSync(`rwx`);
      efs.chmodSync(`rwx`, 0o700);
      const str = 'abc';
      efs.writeFileSync(`rwx/a`, str);
      expect(efs.readFileSync(`rwx/a`, { encoding: 'utf8' })).toEqual(str);
      expect(efs.readdirSync(`rwx`)).toEqual(['a']);
      // efs.chdir(`rwx`)
      const stat = efs.statSync(`rwx/a`);
      expect(stat.isFile()).toStrictEqual(true);
      efs.unlinkSync(`rwx/a`);
      efs.rmdirSync(`rwx`);
    });

    test('changing file permissions does not affect already opened file descriptor', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const str = 'hello';
      efs.writeFileSync(`file`, str);
      efs.chmodSync(`file`, 0o777);
      const fd = efs.openSync(`file`, 'r+');
      efs.chmodSync(`file`, 0o000);
      expect(efs.readFileSync(fd, { encoding: 'utf8' })).toEqual(str);
      efs.closeSync(fd);
      efs.chmodSync(`file`, 0o777);
    });
  });

  //////////////////////////
  // Open, read and write //
  //////////////////////////
  describe('Open, read and write tests', () => {
    test('open - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const filename = `test`;
      efs.writeFileSync(filename, 'something interesting');
      const fd = efs.openSync(filename, 'w+');
      expect(typeof fd).toEqual('number');
    });

    test('write - sync', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const fd = efs.openSync(`test.txt`, 'w+');
      const writeBuf = Buffer.from('Super confidential information');
      efs.writeSync(fd, writeBuf);
    });

    test('write then read - single block', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const fd = efs.openSync(`test.txt`, 'w+');

      const writeBuffer = Buffer.from('Super confidential information');

      const bytesWritten = efs.writeSync(fd, writeBuffer);

      expect(bytesWritten).toEqual(writeBuffer.length);

      const readBuffer = Buffer.alloc(writeBuffer.length);

      const bytesRead = efs.readSync(fd, readBuffer);

      expect(bytesRead).toEqual(bytesWritten);

      expect(writeBuffer).toStrictEqual(readBuffer);
    });

    test('write then read - multiple blocks', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const fd = efs.openSync(`test.txt`, 'w+');

      const blockSize = 4096;

      // Write data
      const writeBuffer = Buffer.from(crypto.randomBytes(blockSize * 3));
      const bytesWritten = efs.writeSync(fd, writeBuffer);

      expect(bytesWritten).toEqual(writeBuffer.length);

      // Read data back
      const readBuffer = Buffer.alloc(writeBuffer.length);
      const bytesRead = efs.readSync(fd, readBuffer);

      expect(bytesRead).toEqual(bytesWritten);

      expect(writeBuffer).toStrictEqual(readBuffer);
    });

    test('write non-zero position - middle of start block - with text buffer', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const blockSize = 4096;

      // Define file descriptor
      const filename = `test_middle_text.txt`;
      const fd = efs.openSync(filename, 'w+');

      // Write initial data
      const writeBuffer = Buffer.alloc(blockSize);

      writeBuffer.write('one two three four five six seven eight nine ten');
      efs.writeSync(fd, writeBuffer);

      // write data in the middle
      const middlePosition = 240;
      const middleText = ' Malcom in the middle ';
      const middleData = Buffer.from(middleText);
      efs.writeSync(fd, middleData, 0, middleData.length, middlePosition);

      // re-read the blocks
      const readBuffer = Buffer.alloc(blockSize);
      efs.readSync(fd, readBuffer, 0, readBuffer.length, 0);

      middleData.copy(writeBuffer, middlePosition);
      const expected = writeBuffer;

      expect(expected).toStrictEqual(readBuffer);
    });

    test('write non-zero position - middle of start block', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const blockSize = 4096;

      // write a three block file
      const writeBuffer = crypto.randomBytes(blockSize * 3);
      const filename = `test_middle.txt`;
      const fd = efs.openSync(filename, 'w+');
      efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0);

      // write data in the middle
      const middlePosition = 2000;
      const middleText = 'Malcom in the';
      const middleData = Buffer.from(middleText);
      efs.writeSync(fd, middleData, 0, middleData.length, middlePosition);

      // re-read the blocks
      const readBuffer = Buffer.alloc(blockSize * 3);
      efs.readSync(fd, readBuffer, 0, readBuffer.length, 0);

      middleData.copy(writeBuffer, middlePosition);
      const expected = writeBuffer;

      expect(expected).toStrictEqual(readBuffer);
    });

    test('write non-zero position - middle of middle block', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const blockSize = 4096;

      // write a three block file
      const writeBuffer = crypto.randomBytes(blockSize * 3);
      const filename = `test_middle.txt`;
      let fd = efs.openSync(filename, 'w+');
      efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0);

      // write data in the middle
      const middlePosition = blockSize + 2000;
      const middleData = Buffer.from('Malcom in the');
      efs.writeSync(fd, middleData, 0, middleData.length, middlePosition);

      // re-read the blocks
      const readBuffer = Buffer.alloc(blockSize * 3);
      fd = efs.openSync(filename);
      efs.readSync(fd, readBuffer, 0, readBuffer.length, 0);

      middleData.copy(writeBuffer, middlePosition);
      const expected = writeBuffer;

      expect(readBuffer).toEqual(expected);
    });

    test('write non-zero position - middle of end block', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const blockSize = 4096;

      // write a three block file
      const writePos = 2 * blockSize + 2000;
      const writeBuffer = crypto.randomBytes(blockSize * 3);
      const fd = efs.openSync(`test_middle.txt`, 'w+');
      efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0);

      // write data in the middle
      const middleData = Buffer.from('Malcom in the');
      efs.writeSync(fd, middleData, 0, middleData.length, writePos);

      // re-read the blocks
      const readBuffer = Buffer.alloc(blockSize * 3);
      efs.readSync(fd, readBuffer, 0, readBuffer.length, 0);

      middleData.copy(writeBuffer, writePos);
      const expected = writeBuffer;

      expect(readBuffer).toEqual(expected);
    });

    test('write segment spanning across two block', () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const blockSize = 4096;

      // write a three block file
      const writeBuffer = crypto.randomBytes(blockSize * 3);
      const fd = efs.openSync(`test_middle.txt`, 'w+');
      efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0);

      // write data in the middle
      const writePos = 4090;
      const middleData = Buffer.from('Malcom in the');
      efs.writeSync(fd, middleData, 0, middleData.length, writePos);

      // re-read the blocks
      const readBuffer = Buffer.alloc(blockSize * 3);
      efs.readSync(fd, readBuffer, 0, readBuffer.length, 0);

      middleData.copy(writeBuffer, writePos);
      const expected = writeBuffer;

      expect(readBuffer).toEqual(expected);
    });
  });

  ////////////////////////
  // Bisimulation tests //
  ////////////////////////
  describe('Bisimulation with nodejs fs tests', () => {
    let efsdataDir: string;
    let fsdataDir: string;
    beforeEach(() => {
      efsdataDir = `efsTesting`;
      fsdataDir = `${dataDir}/fsTesting`;
    });

    describe('one set of read/write operations', () => {
      describe('one set of read/write operations - 1 block', () => {
        test('one set of read/write operations - 1 block - full block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |<---------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer);
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer);
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('one set of read/write operations - 1 block - left block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |<-------->--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            0,
            3000,
            0,
          );
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            0,
            3000,
            0,
          );
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('one set of read/write operations - 1 block - right block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |--<-------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            1000,
            3096,
            1000,
          );
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 1000, 3096, 1000);

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            1000,
            3096,
            1000,
          );
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 1000, 3096, 1000);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('one set of read/write operations - 1 block - not block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |--<------>--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            1000,
            2000,
            1000,
          );
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 1000, 2000, 1000);

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            1000,
            2000,
            1000,
          );
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 1000, 2000, 1000);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });
      });
      describe('one set of read/write operations - 2 block', () => {
        test('one set of read/write operations - 2 block - full block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |<---------->|<---------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer);
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer);
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('one set of read/write operations - 2 block - left block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |<---------->|<-------->--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            0,
            6000,
            0,
          );
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            0,
            6000,
            0,
          );
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('one set of read/write operations - 2 block - right block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |--<-------->|<---------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            1000,
            2 * blockSize - 1000,
            1000,
          );
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            1000,
            2 * blockSize - 1000,
            1000,
          );

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            1000,
            2 * blockSize - 1000,
            1000,
          );
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(
            fsFd,
            fsFirstReadBuffer,
            1000,
            2 * blockSize - 1000,
            1000,
          );

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('one set of read/write operations - 2 block - not block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |--<-------->|<-------->--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            1000,
            6000,
            1000,
          );
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 1000, 6000, 1000);

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            1000,
            6000,
            1000,
          );
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 1000, 6000, 1000);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });
      });
      describe('one set of read/write operations - 3 block', () => {
        test('one set of read/write operations - 3 block - full block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |<---------->|<---------->|<---------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer);
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer);
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('one set of read/write operations - 3 block - left block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |<---------->|<---------->|<-------->--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            0,
            2 * blockSize + 1000,
            0,
          );
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            0,
            2 * blockSize + 1000,
            0,
          );
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('one set of read/write operations - 3 block - right block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |--<-------->|<---------->|<---------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            1000,
            3 * blockSize - 1000,
            1000,
          );
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            1000,
            3 * blockSize - 1000,
            1000,
          );

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            1000,
            3 * blockSize - 1000,
            1000,
          );
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(
            fsFd,
            fsFirstReadBuffer,
            1000,
            3 * blockSize - 1000,
            1000,
          );

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('one set of read/write operations - 3 block - not block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // case: |--<-------->|<---------->|<-------->--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            1000,
            2 * blockSize + 1000,
            1000,
          );
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            1000,
            2 * blockSize + 1000,
            1000,
          );

          // fs
          const fsFilename = `${fsdataDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            1000,
            2 * blockSize + 1000,
            1000,
          );
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(
            fsFd,
            fsFirstReadBuffer,
            1000,
            2 * blockSize + 1000,
            1000,
          );

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });
      });
    });

    describe('read/write operations on existing 3 block file', () => {
      let efsFd: number;
      let fsFd: number;
      const blockSize = 20;
      // Write 3 block file
      // case: |<---------->|<---------->|<---------->|
      const WriteBuffer = crypto.randomBytes(3 * blockSize);

      describe('read/write operations on existing 3 block file - one set of read/write operations - 1 block', () => {
        test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - full block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |<---------->|<==========>|<==========>|
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          const offset = 0;
          const length = blockSize;
          const position = 0;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - left block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |<-------->==|<==========>|<==========>|
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          const offset = 0;
          const length = Math.ceil(blockSize * 0.8);
          const position = 0;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - right block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |==<-------->|<==========>|<==========>|
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = blockSize - offset;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - not block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |==<------>==|<==========>|<==========>|
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = Math.ceil(blockSize * 0.6);
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });
      });
      describe('read/write operations on existing 3 block file - one set of read/write operations - 2 block', () => {
        test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - full block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |<---------->|<---------->|<==========>|
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          const offset = 0;
          const length = 2 * blockSize;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - left block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |<---------->|<-------->==|<==========>|
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          const offset = 0;
          const length = blockSize + Math.ceil(blockSize * 0.8);
          const position = 0;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            offset,
            efsFirstReadBuffer.length,
            position,
          );

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(
            fsFd,
            fsFirstReadBuffer,
            offset,
            fsFirstReadBuffer.length,
            position,
          );

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - right block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |==<-------->|<---------->|<==========>|
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = 2 * blockSize - offset;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - not block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |==<-------->|<-------->==|<==========>|
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = 2 * (blockSize - offset);
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });
      });
      describe('read/write operations on existing 3 block file - one set of read/write operations - 3 block', () => {
        test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - full block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |<---------->|<---------->|<---------->|
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          const offset = 0;
          const length = 3 * blockSize;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - left block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |<---------->|<---------->|<-------->==|
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          const offset = 0;
          const length = 3 * blockSize - Math.ceil(blockSize * 0.2);
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(
            efsFd,
            efsFirstReadBuffer,
            0,
            efsFirstReadBuffer.length,
            0,
          );

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - right block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |==<-------->|<---------->|<---------->|
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = 3 * blockSize - offset;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - not block aligned', () => {
          const vfsInstance = new vfs.VirtualFS();
          const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
          efs.mkdirSync(efsdataDir);
          fs.mkdirSync(fsdataDir);
          // efs
          const efsFilename = `${efsdataDir}/file`;
          efsFd = efs.openSync(efsFilename, 'w+');
          efs.writeSync(efsFd, WriteBuffer);
          // fs
          const fsFilename = `${fsdataDir}/file`;
          fsFd = fs.openSync(fsFilename, 'w+');
          fs.writeSync(fsFd, WriteBuffer);
          // case: |==<-------->|<---------->|<-------->==|
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = 3 * blockSize - 2 * offset;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(
            fsFd,
            firstWriteBuffer,
            offset,
            length,
            position,
          );
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
          efs.rmdirSync(efsdataDir, { recursive: true });
          fs.mkdirSync(fsdataDir, { recursive: true });
        });
      });
    });

    describe('readFile/writeFile operations', () => {
      const blockSize = 4096;

      test('readFile/writeFile operations - under block size', () => {
        const vfsInstance = new vfs.VirtualFS();
        const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
        efs.mkdirSync(efsdataDir);
        fs.mkdirSync(fsdataDir);
        const firstWriteBuffer = crypto.randomBytes(
          Math.ceil(blockSize * Math.random()),
        );
        // efs
        const efsFilename = `${efsdataDir}/file`;
        efs.writeFileSync(efsFilename, firstWriteBuffer);
        const efsFirstReadBuffer = efs.readFileSync(efsFilename);

        // fs
        const fsFilename = `${fsdataDir}/file`;
        fs.writeFileSync(fsFilename, firstWriteBuffer);
        const fsFirstReadBuffer = fs.readFileSync(fsFilename);

        // Comparison
        expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        efs.rmdirSync(efsdataDir, { recursive: true });
        fs.mkdirSync(fsdataDir, { recursive: true });
      });

      test('readFile/writeFile operations - over block size', () => {
        const vfsInstance = new vfs.VirtualFS();
        const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
        efs.mkdirSync(efsdataDir);
        fs.mkdirSync(fsdataDir);
        const firstWriteBuffer = crypto.randomBytes(
          Math.ceil(blockSize + blockSize * Math.random()),
        );
        // efs
        const efsFilename = `${efsdataDir}/file`;
        efs.writeFileSync(efsFilename, firstWriteBuffer);
        const efsFirstReadBuffer = efs.readFileSync(efsFilename);

        // fs
        const fsFilename = `${fsdataDir}/file`;
        fs.writeFileSync(fsFilename, firstWriteBuffer);
        const fsFirstReadBuffer = fs.readFileSync(fsFilename);

        // Comparison
        expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        efs.rmdirSync(efsdataDir, { recursive: true });
        fs.mkdirSync(fsdataDir, { recursive: true });
      });
    });
  });

  describe('aynchronous worker tests', () => {
    test('encryption and decryption using workers', async () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const workerManager = new WorkerManager({ logger });
      await workerManager.start();
      const plainBuf = Buffer.from('very important secret');
      efs.setWorkerManager(workerManager);
      await efs.promises.writeFile(`test`, plainBuf, {});
      const deciphered = await efs.promises.readFile(`test`, {});
      expect(deciphered).toStrictEqual(plainBuf);
      efs.unsetWorkerManager();
      await workerManager.stop();
    });

    test('encryption and decryption using workers for encryption but not decryption', async () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const workerManager = new WorkerManager({ logger });
      await workerManager.start();
      const plainBuf = Buffer.from('very important secret');
      efs.setWorkerManager(workerManager);
      await efs.promises.writeFile(`test`, plainBuf, {});
      efs.unsetWorkerManager();
      await workerManager.stop();
      const deciphered = await efs.promises.readFile(`test`, {});
      expect(deciphered).toStrictEqual(plainBuf);
    });

    test('encryption and decryption using workers for decryption but not encryption', async () => {
      const vfsInstance = new vfs.VirtualFS();
      const efs = new EncryptedFS(key, vfsInstance, fs, '/', dataDir);
      const workerManager = new WorkerManager({ logger });
      await workerManager.start();
      const plainBuf = Buffer.from('very important secret');
      await efs.promises.writeFile(`test`, plainBuf, {});
      efs.setWorkerManager(workerManager);
      const deciphered = await efs.promises.readFile(`test`, {});
      expect(deciphered).toStrictEqual(plainBuf);
      efs.unsetWorkerManager();
      await workerManager.stop();
    });
  });
});
