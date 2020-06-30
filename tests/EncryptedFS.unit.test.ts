import * as os from 'os';
import process from 'process';
import fs, { Stats } from 'fs';
import * as crypto from 'crypto';
import EncryptedFS from '../src/EncryptedFS';
import { Readable, Writable } from 'stream';

// js imports
let vfs = require('virtualfs');

// TODO: implement commented out methods in EFS (they are straight passthroughs from VFS)
describe('EncryptedFS class', () => {
  let tempDir: string;
  let efs: EncryptedFS;

  beforeEach(() => {
    // Create directory in efs:
    // efs = new vfs.VirtualFS
    // efs.mkdirpSync(tempDir)
    const vfsInstance = new vfs.VirtualFS();
    efs = new EncryptedFS('very password', vfsInstance, vfsInstance, fs, process);
    // Define temp directory
    tempDir = efs.mkdtempSync(`${os.tmpdir}/vfstest`);
  });

  afterEach(() => {
    efs.rmdirSync(tempDir, { recursive: true });
  });

  test('initialisation', () => {
    expect(efs).toBeInstanceOf(EncryptedFS);
  });

  test('various failure situations - sync', () => {
    efs.mkdirSync(`${tempDir}/test/dir`, { recursive: true });
    efs.writeFileSync(`${tempDir}/test/file`, 'Hello');

    expect(() => {
      efs.writeFileSync(`${tempDir}/test/dir`, 'Hello');
    }).toThrow();
    expect(() => {
      efs.writeFileSync(`${tempDir}`, 'Hello');
    }).toThrow();
    expect(() => {
      efs.rmdirSync(`${tempDir}`);
    }).toThrow();
    expect(() => {
      efs.unlinkSync(`${tempDir}`);
    }).toThrow();
    expect(() => {
      efs.mkdirSync(`${tempDir}/test/dir`);
    }).toThrow();
    expect(() => {
      efs.mkdirSync(`${tempDir}/test/file`);
    }).toThrow();
    expect(() => {
      efs.mkdirSync(`${tempDir}/test/file`, { recursive: true });
    }).toThrow();
    expect(() => {
      efs.readdirSync(`${tempDir}/test/file`);
    }).toThrow();
    expect(() => {
      efs.readlinkSync(`${tempDir}/test/dir`, {});
    }).toThrow();
    expect(() => {
      efs.readlinkSync(`${tempDir}/test/file`, {});
    }).toThrow();
  });

  test('asynchronous errors are passed to callbacks - async', () => {
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
    efs.writeFileSync(`${tempDir}/test`, 'test data');
    const stat = efs.statSync(`${tempDir}/test`);
    expect(stat.isFile()).toStrictEqual(true);
    expect(stat.isDirectory()).toStrictEqual(false);
    expect(stat.isBlockDevice()).toStrictEqual(false);
    expect(stat.isCharacterDevice()).toStrictEqual(false);
    expect(stat.isSocket()).toStrictEqual(false);
    expect(stat.isSymbolicLink()).toStrictEqual(false);
    expect(stat.isFIFO()).toStrictEqual(false);
  });

  test('dir stat makes sense - sync', () => {
    efs.mkdirSync(`${tempDir}/dir`);
    const stat = efs.statSync(`${tempDir}/dir`);
    expect(stat.isFile()).toStrictEqual(false);
    expect(stat.isDirectory()).toStrictEqual(true);
    expect(stat.isBlockDevice()).toStrictEqual(false);
    expect(stat.isCharacterDevice()).toStrictEqual(false);
    expect(stat.isSocket()).toStrictEqual(false);
    expect(stat.isSymbolicLink()).toStrictEqual(false);
    expect(stat.isFIFO()).toStrictEqual(false);
  });

  test('symlink stat makes sense - sync', () => {
    efs.writeFileSync(`${tempDir}/a`, 'data');
    efs.symlinkSync(`${tempDir}/a`, `${tempDir}/link-to-a`);
    const stat = efs.lstatSync(`${tempDir}/link-to-a`);
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
    const buffer = Buffer.from('Hello World', 'utf8');
    efs.writeFileSync(`${tempDir}/hello-world`, buffer);

    expect(efs.readFileSync(`${tempDir}/hello-world`, {})).toEqual(buffer);

    expect(efs.readFileSync(`${tempDir}/hello-world`, { encoding: 'utf8' })).toBe('Hello World');

    efs.writeFileSync(`${tempDir}/a`, 'Test', { encoding: 'utf-8' });
    expect(efs.readFileSync(`${tempDir}/a`, { encoding: 'utf-8' })).toBe('Test');

    const stat = efs.statSync(`${tempDir}/a`);
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
    expect(stat.isDirectory()).toBe(false);

    efs.writeFileSync(`${tempDir}/b`, 'Test', { encoding: 'utf8' });
    expect(efs.readFileSync(`${tempDir}/b`, { encoding: 'utf-8' })).toEqual('Test');
    expect(() => {
      expect(efs.readFileSync(`${tempDir}/other-file`, {})).toThrow();
    }).toThrow();
    expect(() => {
      expect(efs.readFileSync(`${tempDir}/other-file`, { encoding: 'utf8' })).toThrow();
    }).toThrow();
  });

  /////////////////
  // directories //
  /////////////////

  describe('directories', () => {
    test('has an empty root directory at startup - sync', () => {
      expect(efs.readdirSync(`${tempDir}`)).toEqual([]);
      const stat = efs.statSync(`${tempDir}`);
      expect(stat.isFile()).toStrictEqual(false);
      expect(stat.isDirectory()).toStrictEqual(true);
      expect(stat.isSymbolicLink()).toStrictEqual(false);
    });

    test('has an empty root directory at startup - async', (done) => {
      efs.promises.readdir(`${tempDir}`).then((list) => {
        expect(list).toEqual([]);
        efs.promises.stat(`${tempDir}`)
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
      efs.mkdirSync(`${tempDir}/first`, { recursive: true });
      efs.mkdirSync(`${tempDir}/first//sub/`, { recursive: true });
      efs.mkdirSync(`${tempDir}/first/sub/subsub`);
      efs.mkdirSync(`${tempDir}/first/sub2`, { recursive: true });
      efs.mkdirSync(`${tempDir}/backslash\\dir`);
      expect(efs.readdirSync(`${tempDir}`)).toEqual(["backslash\\dir", "first"]);
      expect(efs.readdirSync(`${tempDir}/first/`)).toEqual(['sub', 'sub2']);
      efs.mkdirSync(`${tempDir}/a/depth/sub/dir`, { recursive: true });
      expect(efs.existsSync(`${tempDir}/a/depth/sub`)).toStrictEqual(true);
      const stat = efs.statSync(`${tempDir}/a/depth/sub`);
      expect(stat.isFile()).toStrictEqual(false);
      expect(stat.isDirectory()).toStrictEqual(true);
    });

    test('is able to make directories - async', (done) => {
      efs.promises.mkdir(`${tempDir}/first`).then(() => {
        efs.promises.mkdir(`${tempDir}/first//sub/`).then(() => {
          efs.promises.mkdir(`${tempDir}/first/sub2/`).then(() => {
            efs.promises.mkdir(`${tempDir}/backslash\\dir`, { recursive: true }).then(() => {
              efs.promises.readdir(`${tempDir}`).then((list) => {
                expect(list).toEqual(['backslash\\dir', 'first']);
                efs.promises.readdir(`${tempDir}/first/`).then((list) => {
                  expect(list).toEqual(['sub', 'sub2']);
                  efs.promises.mkdir(`${tempDir}/a/depth/sub/dir`, { recursive: true }).then(() => {
                    efs.promises.exists(`${tempDir}/a/depth/sub`).then((exists) => {
                      expect(exists).toEqual(true);
                      efs.promises.stat(`${tempDir}/a/depth/sub`).then((stat) => {
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
    });

    test('should not make the root directory - sync', () => {
      expect(() => {
        efs.mkdirSync('/');
      }).toThrow('EEXIST');
    });

    // test('should be able to navigate before root - sync', () => {
    // 	const buffer = Buffer.from('Hello World')
    // 	efs.mkdirSync(`${tempDir}/first`)
    // 	efs.writeFileSync(`${tempDir}/hello-world.txt`, buffer)
    // 	let stat: Stat
    // 	stat = efs.statSync(`${tempDir}/first/../../../../first`)
    // 	expect(stat.isFile()).toStrictEqual(false)
    // 	expect(stat.isDirectory()).toStrictEqual(true)
    // 	stat = efs.statSync(`${tempDir}/first/../../../../hello-world.txt`)
    // 	expect(stat.isFile()).toStrictEqual(true)
    // 	expect(stat.isDirectory()).toStrictEqual(false)
    // })

    test('should be able to remove directories - sync', () => {
      efs.mkdirSync(`${tempDir}/first`);
      efs.mkdirSync(`${tempDir}/first//sub/`);
      efs.mkdirSync(`${tempDir}/first/sub2`);
      efs.mkdirSync(`${tempDir}/backslash\\dir`);
      efs.rmdirSync(`${tempDir}/first/sub//`);
      const firstlist = efs.readdirSync(`${tempDir}//first`);
      expect(firstlist).toEqual(['sub2']);
      efs.rmdirSync(`${tempDir}/first/sub2`);
      efs.rmdirSync(`${tempDir}/first`);
      const exists = efs.existsSync(`${tempDir}/first`);
      expect(exists).toEqual(false);
      expect(() => {
        efs.accessSync(`${tempDir}/first`);
      }).toThrow('ENOENT');
      expect(() => {
        efs.readdirSync(`${tempDir}/first`);
      }).toThrow('ENOENT');
      const rootlist = efs.readdirSync(`${tempDir}`);
      expect(rootlist).toEqual(['backslash\\dir']);
    });

    test('rmdir does not traverse the last symlink', () => {
      efs.mkdirSync(`${tempDir}/directory`);
      efs.symlinkSync(`${tempDir}/directory`, `${tempDir}/linktodirectory`);
      expect(() => {
        efs.rmdirSync(`${tempDir}/linktodirectory`);
      }).toThrow('ENOTDIR');
    });

    test('creating temporary directories - sync', () => {
      const tempSubDir = `${tempDir}/dir`;
      efs.mkdirSync(tempSubDir);
      const buffer = Buffer.from('abc');
      efs.writeFileSync(`${tempSubDir}/test`, buffer);
      expect(efs.readFileSync(`${tempSubDir}/test`, { encoding: 'utf8' })).toEqual(buffer.toString());
    });

    test('trailing slash refers to the directory instead of a file - sync', () => {
      efs.writeFileSync(`${tempDir}/abc`, '');
      expect(() => {
        efs.accessSync(`${tempDir}/abc/`, undefined);
      }).toThrow('ENOTDIR');
      expect(() => {
        efs.accessSync(`${tempDir}/abc/.`, undefined);
      }).toThrow('ENOTDIR');
      expect(() => {
        efs.mkdirSync(`${tempDir}/abc/.`);
      }).toThrow('ENOTDIR');
      expect(() => {
        efs.mkdirSync(`${tempDir}/abc/`);
      }).toThrow('EEXIST');
    });

    test('trailing slash works for non-existent directories when intending to create them - sync', () => {
      efs.mkdirSync(`${tempDir}/abc/`);
      const stat = efs.statSync(`${tempDir}/abc/`);
      expect(stat.isDirectory()).toStrictEqual(true);
    });

    test('trailing `/.` for mkdirSync should result in errors', () => {
      // const efs = new vfs.VirtualFS

      expect(() => {
        efs.mkdirSync(`${tempDir}/abc/.`);
      }).toThrow('ENOENT');
      efs.mkdirSync(`${tempDir}/abc`);
      expect(() => {
        efs.mkdirSync(`${tempDir}/abc/.`);
      }).toThrow('EEXIST');
    });

    test('trailing `/.` for a recursive mkdirSync should not result in any errors', () => {
      efs.mkdirSync(`${tempDir}/abc/.`, { recursive: true });
      const stat = efs.statSync(`${tempDir}/abc`);
      expect(stat.isDirectory()).toStrictEqual(true);
    });
  });

  ///////////////
  // hardlinks //
  ///////////////

  describe('hardlinks', () => {
    test('multiple hardlinks to the same file - sync', () => {
      efs.mkdirSync(`${tempDir}/test`);
      efs.writeFileSync(`${tempDir}/test/a`, '');
      efs.linkSync(`${tempDir}/test/a`, `${tempDir}/test/b`);
      const inoA = efs.statSync(`${tempDir}/test/a`).ino;
      const inoB = efs.statSync(`${tempDir}/test/b`).ino;
      expect(inoA).toEqual(inoB);
      expect(efs.readFileSync(`${tempDir}/test/a`, {})).toEqual(efs.readFileSync(`${tempDir}/test/b`, {}));
    });

    test('should not create hardlinks to directories - sync', () => {
      efs.mkdirSync(`${tempDir}/test`);

      expect(() => {
        efs.linkSync(`${tempDir}/test`, `${tempDir}/hardlinkttotest`);
      }).toThrow('EPERM');
    });
  });

  //////////////
  // symlinks //
  //////////////

  describe('symlinks', () => {
    test('symlink paths can contain multiple slashes', () => {
      efs.mkdirSync(`${tempDir}/dir`);
      efs.writeFileSync(`${tempDir}/dir/test`, 'hello');
      efs.symlinkSync(`${tempDir}////dir////test`, `${tempDir}/linktodirtest`);
      expect(efs.readFileSync(`${tempDir}/dir/test`, {})).toEqual(
        efs.readFileSync(`${tempDir}/linktodirtest`, {}),
      );
    });

    test('resolves symlink loops 1 - sync', () => {
      efs.symlinkSync(`${tempDir}/test`, `${tempDir}/test`);

      expect(() => {
        efs.readFileSync(`${tempDir}/test`, {});
      }).toThrow('ELOOP');
    });

    test('resolves symlink loops 2 - sync', () => {
      efs.mkdirSync(`${tempDir}/dirtolink`);
      efs.symlinkSync(`${tempDir}/dirtolink/test`, `${tempDir}/test`);
      efs.symlinkSync(`${tempDir}/test`, `${tempDir}/dirtolink/test`);

      expect(() => {
        efs.readFileSync(`${tempDir}/test/non-existent`, {});
      }).toThrow('ELOOP');
    });

    test('is able to add and traverse symlinks transitively - sync', () => {
      efs.mkdirSync(`${tempDir}/test`);
      const buffer = Buffer.from('Hello World');
      efs.writeFileSync(`${tempDir}/test/hello-world.txt`, buffer);
      efs.symlinkSync(`${tempDir}/test`, `${tempDir}/linktotestdir`);
      expect(efs.readlinkSync(`${tempDir}/linktotestdir`, {})).toEqual(`${tempDir}/test`);
      expect(efs.readdirSync(`${tempDir}/linktotestdir`)).toEqual(['hello-world.txt']);
      efs.symlinkSync(`${tempDir}/linktotestdir/hello-world.txt`, `${tempDir}/linktofile`);
      efs.symlinkSync(`${tempDir}/linktofile`, `${tempDir}/linktolink`);
      expect(efs.readFileSync(`${tempDir}/linktofile`, { encoding: 'utf-8' })).toEqual('Hello World');
      expect(efs.readFileSync(`${tempDir}/linktolink`, { encoding: 'utf-8' })).toEqual('Hello World');
    });

    test('is able to traverse relative symlinks - sync', () => {
      efs.mkdirSync(`${tempDir}/test`);
      const buffer = Buffer.from('Hello World');
      efs.writeFileSync(`${tempDir}/a`, buffer);
      efs.symlinkSync(`${tempDir}/a`, `${tempDir}/test/linktoa`);
      expect(efs.readFileSync(`${tempDir}/test/linktoa`, { encoding: 'utf-8' })).toEqual('Hello World');
    });

    test('unlink does not traverse symlinks - sync', () => {
      efs.mkdirSync(`${tempDir}/test`);
      const buffer = Buffer.from('Hello World');
      efs.writeFileSync(`${tempDir}/test/hello-world.txt`, buffer);
      efs.symlinkSync(`${tempDir}/test`, `${tempDir}/linktotestdir`);
      efs.symlinkSync(`${tempDir}/linktotestdir/hello-world.txt`, `${tempDir}/linktofile`);
      efs.unlinkSync(`${tempDir}/linktofile`);
      efs.unlinkSync(`${tempDir}/linktotestdir`);
      expect(efs.readdirSync(`${tempDir}/test`)).toEqual(['hello-world.txt']);
    });

    test('realpath expands symlinks - sync', () => {
      efs.writeFileSync(`${tempDir}/test`, Buffer.from('Hello'));
      efs.symlinkSync(`./test`, `${tempDir}/linktotest`);
      efs.mkdirSync(`${tempDir}/dirwithlinks`);
      efs.symlinkSync(`../linktotest`, `${tempDir}/dirwithlinks/linktolink`);
      const realPath = efs.realpathSync(`${tempDir}/dirwithlinks/linktolink`);
      expect(realPath).toEqual(`${tempDir}/test`);
    });
  });

  /////////////
  // streams //
  /////////////

  describe('streams', () => {
    test('readstream options start and end are both inclusive - async', (done) => {
      const str = 'Hello';
      efs.writeFileSync(`${tempDir}/test`, str);
      const readable = efs.createReadStream(`${tempDir}/test`, {
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

    // test('readstreams respect start and end options - async', done => {
    // 	const str = 'Hello'
    // 	efs.writeFileSync(`${tempDir}/file`, str)
    // 	efs.createReadStream(`${tempDir}/file`, {
    // 		start: 1,
    // 		end: 3
    // 	}).pipe(bl((err: Error, data: { toString: (arg0: string) => any }) => {
    // 		expect(data.toString('utf8')).toEqual(str.slice(1, 4))
    // 		done()
    // 	}))
    // })

    test('readstream respects the start option - async', (done) => {
      const str = 'Hello';
      const filePath = `${tempDir}/file`;
      efs.writeFileSync(filePath, str, { encoding: 'utf8' });

      const readable = efs.createReadStream(filePath, { encoding: 'utf8', start: 0, end: str.length });
      expect.assertions(1);
      readable.on('readable', () => {
        const readStr = readable.read();
        if (readStr) {
          expect(readStr.slice(0, str.length)).toEqual(str.slice(0, str.length));
          done();
        }
      });
    });

    test('readstream end option is ignored without the start option - async', (done) => {
      const str = 'Hello';
      const filePath = `${tempDir}/file`;
      efs.writeFileSync(filePath, str);
      const readable = efs.createReadStream(filePath, { encoding: 'utf8', end: str.length });
      expect.assertions(1);
      readable.on('readable', () => {
        const readStr = readable.read();
        if (readStr) {
          expect(readStr.slice(0, str.length)).toEqual(str.slice(0, str.length));
          done();
        }
      });
    });

    test('readstream can use a file descriptor - async', (done) => {
      const str = 'Hello';
      const filePath = `${tempDir}/file`;
      efs.writeFileSync(filePath, str);
      const fd = efs.openSync(filePath, 'r');
      const readable = efs.createReadStream('', { encoding: 'utf8', fd: fd, end: str.length });
      expect.assertions(1);
      readable.on('readable', () => {
        const readStr = readable.read();
        if (readStr) {
          expect(readStr.slice(0, str.length)).toEqual(str.slice(0, str.length));
          done();
        }
      });
    });

    // test('readstream with start option overrides the file descriptor position - async', done => {
    // 	const str = 'Hello'
    // 	efs.writeFileSync(`${tempDir}/file`, str)
    // 	const fd = efs.openSync(`${tempDir}/file`, 'r')
    // 	const offset = 1
    // 	const readable = efs.createReadStream('', {encoding: 'utf8', fd: fd, start: offset, end: 10})
    // 	readable.on('readable', () => {
    // 		const readStr = readable.read()
    // 		if (readStr) {
    // 			expect(readStr).toEqual(str.slice(offset))
    // 			done()
    // 		}
    // 	})
    // })

    // test('readstreams handle errors asynchronously - async', done => {
    // 	let stream = efs.createReadStream(`${tempDir}/file`, {})
    // 	expect.assertions(2)
    // 	stream.on('error', (e) => {
    // 		expect(e).toBeInstanceOf(Error)
    // 		expect(e).toEqual('ENOENT')
    // 		done()
    // 	})
    // 	stream.read(10)
    // })

    test('readstreams can compose with pipes - async', (done) => {
      const str = 'Hello';
      efs.writeFileSync(`${tempDir}/file`, str);
      expect.assertions(1);
      const readStream = efs.createReadStream(`${tempDir}/file`, { encoding: 'utf8', end: 10 })
      readStream.on('data', data => {
        expect(data.toString('utf8').slice(0, str.length)).toEqual(str.slice(0, str.length));
        done();
      })
    });

    test('writestream can create and truncate files - async', (done) => {
      const str = 'Hello';
      const fileName = `${tempDir}/file`;
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
      const str = 'Hello';
      expect.assertions(1);
      const stream = efs.createWriteStream(`${tempDir}/file`, {})
      stream.write(Buffer.from(str))
      stream.end()
      stream.on('finish', () => {
        expect(efs.readFileSync(`${tempDir}/file`, { encoding: 'utf-8' })).toEqual(str);
        done();
      })
    });

    test('writestreams handle errors asynchronously - async', (done) => {
      const fileName = `${tempDir}/file/unknown`;
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

    // test('writestreams allow ignoring of the drain event, temporarily ignoring resource usage control - async', done => {
    // 	const waterMark = 10
    // 	const fileName = `${tempDir}/file`
    // 	const writable = efs.createWriteStream(fileName, {highWaterMark: waterMark})
    // 	const buffer = Buffer.allocUnsafe(waterMark).fill(97)
    // 	const times = 4
    // 	for (let i = 0; i < times; ++i) {
    // 		expect(writable.write(buffer)).toEqual(false)
    // 	}
    // 	expect.assertions(1)
    // 	writable.end(() => {
    // 		const readBuffer = efs.readFileSync(fileName, {encoding:'utf-8'})
    // 		expect(readBuffer).toEqual(buffer.toString().repeat(times))
    // 		done()
    // 	})
    // })

    // test('writestreams can use the drain event to manage resource control - async', done => {
    // 	const waterMark = 10
    // 	const fileName = `${tempDir}/file`
    // 	const writable = efs.createWriteStream(fileName, {highWaterMark: waterMark})
    // 	const buf = Buffer.allocUnsafe(waterMark).fill(97)
    // 	let times = 10
    // 	const timesOrig  = times
    // 	expect.assertions(2)
    // 	const writing = () => {
    // 		let status: boolean
    // 		do {
    // 			status = writable.write(buf)
    // 			times -= 1
    // 			if (times === 0) {
    // 			writable.end(() => {
    // 				expect(
    // 					efs.readFileSync(fileName, {encoding:'utf8'})
    // 				).toEqual(buf.toString().repeat(timesOrig))
    // 				done()
    // 			})
    // 			}
    // 		} while (times > 0 && status)

    // 		if (times > 0) {
    // 			writable.once('drain', writing)
    // 		}
    // 	}
    // 	writing()
    // })
  });

  ///////////////////////
  // stat time changes //
  ///////////////////////

  describe('stat time changes', () => {
    test('truncate and ftruncate will change mtime and ctime - async', (done) => {
      // const efs = new vfs.VirtualFS
      // efs.mkdirpSync(tempDir)
      const str = 'abcdef';
      efs.writeFileSync(`${tempDir}/test`, str);
      const stat = efs.statSync(`${tempDir}/test`);
      setTimeout(() => {
        efs.truncateSync(`${tempDir}/test`, str.length);
        const stat2 = efs.statSync(`${tempDir}/test`);
        expect(stat.mtime < stat2.mtime && stat.ctime < stat2.ctime).toEqual(true);
        setTimeout(() => {
          const fd = efs.openSync(`${tempDir}/test`, 'r+');
          efs.ftruncateSync(fd, str.length);
          const stat3 = efs.statSync(`${tempDir}/test`);
          expect(stat2.mtime < stat3.mtime && stat2.ctime < stat3.ctime).toEqual(true);
          setTimeout(() => {
            efs.truncateSync(fd, str.length);
            const stat4 = efs.statSync(`${tempDir}/test`);
            expect(stat3.mtime < stat4.mtime && stat3.ctime < stat4.ctime).toEqual(true);
            efs.closeSync(fd);
            done();
          }, 10);
        }, 10);
      }, 10);
    });

    // test('fallocate will only change ctime - async', done => {
    // 	const fd = efs.openSync(`${tempDir}/allocate`, 'w')
    // 	efs.writeSync(fd, 'abcdef')
    // 	const stat = efs.statSync(`${tempDir}/allocate`)
    // 	const offset = 0
    // 	const length = 100
    // 	efs.fallocate(fd, offset, length, (err) => {
    // 		// expect(err).toBeNull()
    // 		const stat2 = efs.statSync(`${tempDir}/allocate`)
    // 		// expect(stat2.size).toEqual(offset + length)
    // 		expect(stat2.ctime > stat.ctime).toEqual(true)
    // 		expect(stat2.mtime === stat.mtime).toEqual(true)
    // 		expect(stat2.atime === stat.atime).toEqual(true)
    // 		efs.closeSync(fd)
    // 		done()
    // 	})
    // })
  });

  ////////////////////////////////
  // directory file descriptors //
  ////////////////////////////////
  describe('directory file descriptors', () => {
    test('directory file descriptors capabilities - async', (done) => {
      const dirName = `${tempDir}/dir`;
      efs.mkdirSync(dirName);
      const dirfd = efs.openSync(dirName, 'r');
      efs.fsyncSync(dirfd);
      efs.fdatasyncSync(dirfd);
      efs.fchmodSync(dirfd, 0o666);
      efs.fchownSync(dirfd, 0, 0);
      const date = new Date();
      efs.futimesSync(dirfd, date, date);
      const stats: Stats = efs.fstatSync(dirfd);
      // expect(stats).toBeInstanceOf(Stat)
      // expect(stats.atime).toEqual(date)
      // expect(stats.mtime).toEqual(date)
      efs.closeSync(dirfd);
      done();
    });

    test('directory file descriptor errors - sync', (done) => {
      const dirName = `${tempDir}/dir`;
      efs.mkdirSync(dirName);

      // opening it without fs.constants.O_RDONLY would result in EISDIR
      const dirfd = efs.openSync(dirName, undefined, efs.constants.O_RDONLY | efs.constants.O_DIRECTORY);
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
        efs.writeFileSync(dirfd, `${tempDir}/test`);
      }).toThrow('EISDIR');

      efs.closeSync(dirfd);
      done();
    });

    test('directory file descriptors inode nlink becomes 0 after deletion of the directory', (done) => {
      const dirName = `${tempDir}/dir`;
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
      expect(() => {
        let fd: number;
        fd = efs.openSync(`${tempDir}/test`, 'w+');
        efs.closeSync(fd);
        fd = efs.openSync(`${tempDir}/test2`, 'w+', 0o666);
        efs.closeSync(fd);
      }).not.toThrow();
    });

    test('open calling styles work - async', (done) => {
      efs.promises.open(`${tempDir}/test`, 'w+')
        .then((fd) => {
          efs.closeSync(fd!);
          efs.promises.open(`${tempDir}/test2`, 'w+', 0o666)
            .then((fd) => {
              efs.promises.close(fd!)
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
      const str = 'Hello World';
      const buf = Buffer.from(str).fill(0);
      efs.writeFileSync(`${tempDir}/test`, str);
      const fd = efs.openSync(`${tempDir}/test`, 'r+');
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
      // fs.read does not have intermediate optional parameters
      const str = 'Hello World';
      const buf = Buffer.from(str).fill(0);
      efs.writeFileSync(`${tempDir}/test`, str);
      const fd = efs.openSync(`${tempDir}/test`, 'r+');
      const readBuf = Buffer.allocUnsafe(buf.length);
      efs.promises.read(fd, readBuf, 0, buf.length)
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
      const fd = efs.openSync(`${tempDir}/test`, 'w');
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
      // expect(efs.readFileSync(`${tempDir}/test`, {encoding: 'utf-8'})).toEqual(str.repeat(7))
    });

    test('write calling styles work - async', (done) => {
      // fs.write has intermediate optional parameters
      const fd = efs.openSync(`${tempDir}/test`, 'w+');
      const str = 'Hello World';
      const buf = Buffer.from(str);
      efs.promises.write(fd, buf)
        .then((bytesWritten) => {
          expect(bytesWritten).toEqual(buf.length);
          const readBuf = Buffer.allocUnsafe(buf.length);
          efs.readSync(fd, readBuf);
          expect(readBuf).toEqual(buf);
          efs.promises.write(fd, buf)
            .then((bytesWritten) => {
              expect(bytesWritten).toEqual(buf.length);
              const readBuf = Buffer.allocUnsafe(buf.length);
              efs.readSync(fd, readBuf);
              expect(readBuf).toEqual(buf);
              efs.promises.write(fd, buf, undefined, buf.length)
                .then((bytesWritten) => {
                  expect(bytesWritten).toEqual(buf.length);
                  const readBuf = Buffer.allocUnsafe(buf.length);
                  efs.readSync(fd, readBuf);
                  expect(readBuf).toEqual(buf);
                  efs.promises.write(fd, buf, undefined, buf.length)
                    .then((bytesWritten) => {
                      expect(bytesWritten).toEqual(buf.length);
                      const readBuf = Buffer.allocUnsafe(buf.length);
                      efs.readSync(fd, readBuf);
                      expect(readBuf).toEqual(buf);
                      efs.promises.writeFile(fd, str, {})
                        .then(() => {
                          const readBuf = Buffer.allocUnsafe(buf.length);
                          efs.readSync(fd, readBuf);
                          expect(readBuf).toEqual(buf);
                          efs.promises.writeFile(fd, str, {})
                            .then(() => {
                              const readBuf = Buffer.allocUnsafe(buf.length);
                              efs.readSync(fd, readBuf);
                              expect(readBuf).toEqual(buf);
                              efs.promises.writeFile(fd, str, {})
                                .then(() => {
                                  const readBuf = Buffer.allocUnsafe(buf.length);
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
      const str = 'Hello World';
      const buf = Buffer.from(str);
      efs.writeFileSync(`${tempDir}/test`, buf);
      const fd = efs.openSync(`${tempDir}/test`, 'r+');
      let contents: Buffer | string;
      contents = efs.readFileSync(`${tempDir}/test`, {});
      expect(contents).toEqual(buf);
      contents = efs.readFileSync(`${tempDir}/test`, { encoding: 'utf8', flag: 'r' });
      expect(contents).toEqual(str);
      // contents = efs.readFileSync(fd, {})
      // expect(contents).toEqual(buf)
      // contents = efs.readFileSync(fd, { encoding: 'utf8', flag: 'r' })
      // expect(contents).toEqual('')
      efs.closeSync(fd);
    });

    test('readFile calling styles work - async', (done) => {
      const str = 'Hello World';
      const buf = Buffer.from(str);
      efs.writeFileSync(`${tempDir}/test`, buf);
      const fd = efs.openSync(`${tempDir}/test`, 'r+');
      efs.promises.readFile(`${tempDir}/test`, {}).then((data) => {
        expect(data).toEqual(buf);
        efs.promises.readFile(`${tempDir}/test`, { encoding: 'utf8', flag: 'r' }).then((buffer) => {
          expect(buffer.toString()).toEqual(str);
          efs.promises.readFile(fd).then((buffer) => {
            expect(buffer).toEqual(buf);
            done();
          });
        });
      });
    });

    test('writeFileSync calling styles work - sync', () => {
      const fd = efs.openSync(`${tempDir}/test`, 'w+');
      const str = 'Hello World';
      const buf = Buffer.from(str);
      efs.writeFileSync(`${tempDir}/test`, str);
      expect(efs.readFileSync(`${tempDir}/test`, {})).toEqual(buf);
      efs.writeFileSync(`${tempDir}/test`, str, { encoding: 'utf8', mode: 0o666, flag: 'w' });
      expect(efs.readFileSync(`${tempDir}/test`, {})).toEqual(buf);
      efs.writeFileSync(`${tempDir}/test`, buf);
      expect(efs.readFileSync(`${tempDir}/test`, {})).toEqual(buf);
      efs.writeFileSync(fd, str);
      expect(efs.readFileSync(`${tempDir}/test`, {})).toEqual(buf);
      efs.writeFileSync(fd, str, { encoding: 'utf8', mode: 0o666, flag: 'w' });
      expect(efs.readFileSync(`${tempDir}/test`, {})).toEqual(buf);
      efs.writeFileSync(fd, buf);
      expect(efs.readFileSync(`${tempDir}/test`, {})).toEqual(buf);
      efs.closeSync(fd);
    });

    test('writeFile calling styles work - async', (done) => {
      const fd = efs.openSync(`${tempDir}/test`, 'w+');
      const str = 'Hello World';
      const buf = Buffer.from(str);
      efs.promises.writeFile(`${tempDir}/test`, str, {}).then(() => {
        efs.promises.writeFile(`${tempDir}/test`, str, { encoding: 'utf8', mode: 0o666, flag: 'w' })
          .then(() => {
            efs.promises.writeFile(`${tempDir}/test`, buf, {})
              .then(() => {
                efs.promises.writeFile(fd, str, {})
                  .then(() => {
                    efs.promises.writeFile(fd, str, { encoding: 'utf8', mode: 0o666, flag: 'w' })
                      .then(() => {
                        efs.promises.writeFile(fd, buf, {})
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

  ////////////////////////////////////
  // current directory side effects //
  ////////////////////////////////////
  describe('current directory side effects', () => {
    test('getCwd returns the absolute fully resolved path - sync', () => {
      efs.mkdirSync(`${tempDir}/a/b`, { recursive: true });
      efs.symlinkSync(`${tempDir}/a/b`, `${tempDir}/c`);
      efs.chdir(`${tempDir}/c`);
      const cwd = efs.getCwd();
      expect(cwd).toEqual(`${tempDir}/a/b`);
    });

    test('getCwd still works if the current directory is deleted - sync', () => {
      // nodejs process.cwd() will actually throw ENOENT
      // but making it work in VFS is harmless
      efs.mkdirSync(`${tempDir}/a/b`, { recursive: true });
      efs.mkdirSync(`${tempDir}/removed`);
      efs.chdir(`${tempDir}/removed`);
      efs.rmdirSync(`../removed`);
      expect(efs.getCwd()).toEqual(`${tempDir}/removed`);
    });

    test('deleted current directory can still use . and .. for traversal - sync', () => {
      efs.mkdirSync(`${tempDir}/removed`);
      const statRoot = efs.statSync(`${tempDir}`);
      efs.chdir(`${tempDir}/removed`);
      const statCurrent1 = efs.statSync('.');
      efs.rmdirSync('../removed');
      const statCurrent2 = efs.statSync('.');
      const statParent = efs.statSync('..');
      expect(statCurrent1.ino).toEqual(statCurrent2.ino);
      expect(statRoot.ino).toEqual(statParent.ino);
      expect(statCurrent2.nlink).toEqual(1);
      expect(statParent.nlink).toEqual(3);
      const dentryCurrent = efs.readdirSync('.');
      const dentryParent = efs.readdirSync('..');
      expect(dentryCurrent).toEqual([]);
      expect(dentryParent).toEqual([]);
    });

    test('cannot create inodes within a deleted current directory - sync', () => {
      efs.writeFileSync(`${tempDir}/dummy`, 'hello');
      efs.mkdirSync(`${tempDir}/removed`);
      efs.chdir(`${tempDir}/removed`);
      efs.rmdirSync('../removed');

      expect(() => {
        efs.writeFileSync('./a', 'abc');
      }).toThrow('ENOENT');
      expect(() => {
        efs.mkdirSync('./b');
      }).toThrow('ENOENT');
      expect(() => {
        efs.symlinkSync('../dummy', 'c');
      }).toThrow('ENOENT');
      expect(() => {
        efs.linkSync('../dummy', 'd');
      }).toThrow('ENOENT');
    });

    test('can still chdir when both current and parent directories are deleted', () => {
      efs.mkdirSync(`${tempDir}/removeda/removedb`, { recursive: true });
      efs.chdir(`${tempDir}/removeda/removedb`);
      efs.rmdirSync('../removedb');
      efs.rmdirSync('../../removeda');
      efs.chdir('..');
      efs.chdir('..');
      const path = efs.getCwd();
      expect(path).toEqual(`${tempDir}`);
    });

    test('cannot chdir into a directory without execute permissions', () => {
      efs.mkdirSync(`${tempDir}/dir`);
      efs.chmodSync(`${tempDir}/dir`, 0o666);
      efs.setUid(1000);

      expect(() => {
        efs.chdir(`${tempDir}/dir`);
      }).toThrow('EACCES');
    });

    test('cannot delete current directory using .', () => {
      efs.mkdirSync(`${tempDir}/removed`);
      efs.chdir(`${tempDir}/removed`);

      expect(() => {
        efs.rmdirSync('.');
      }).toThrow('EINVAL');
    });

    test('cannot delete parent directory using .. even when current directory is deleted', () => {
      efs.mkdirSync(`${tempDir}/removeda/removedb`, { recursive: true });
      efs.chdir(`${tempDir}/removeda/removedb`);
      efs.rmdirSync('../removedb');
      efs.rmdirSync('../../removeda');

      // linux reports this as ENOTEMPTY, but EINVAL makes more sense
      expect(() => {
        efs.rmdirSync('..');
      }).toThrow('EINVAL');
    });

    test('cannot rename the current or parent directory to a subdirectory', () => {
      efs.mkdirSync(`${tempDir}/cwd`);
      efs.chdir(`${tempDir}/cwd`);

      expect(() => {
        efs.renameSync('.', 'subdir');
      }).toThrow('EBUSY');
      efs.mkdirSync(`${tempDir}/cwd/cwd`);
      efs.chdir(`${tempDir}/cwd/cwd`);
      expect(() => {
        efs.renameSync('..', 'subdir');
      }).toThrow('EBUSY');
    });

    test('cannot rename where the old path is a strict prefix of the new path', () => {
      efs.mkdirSync(`${tempDir}/cwd1/cwd2`, { recursive: true });
      efs.chdir(`${tempDir}/cwd1/cwd2`);

      expect(() => {
        efs.renameSync('../cwd2', 'subdir');
      }).toThrow('EINVAL');
      efs.mkdirSync(`${tempDir}/cwd1/cwd2/cwd3`);
      expect(() => {
        efs.renameSync('./cwd3', './cwd3/cwd4');
      }).toThrow('EINVAL');
    });
  });

  /////////////////
  // permissions //
  /////////////////
  describe('permissions', () => {
    // test('chown changes uid and gid - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/test`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/test`, 1000, 2000)
    // 	const stat = efs.statSync(`${tempDir}/test`)
    // 	expect(stat.uid).toEqual(1000)
    // 	expect(stat.gid).toEqual(2000)
    // })

    test('chmod with 0 wipes out all permissions - sync', () => {
      efs.writeFileSync(`${tempDir}/a`, 'abc');
      efs.chmodSync(`${tempDir}/a`, 0o000);
      const stat = efs.statSync(`${tempDir}/a`);
      expect(stat.mode).toEqual(efs.constants.S_IFREG);
    });

    test('mkdir and chmod affects the mode - promises', (done) => {
      efs.promises.mkdir(`${tempDir}/test`, { mode: 0o644 }).then(() => {
        efs.accessSync(`${tempDir}/test`, efs.constants.F_OK | efs.constants.R_OK | efs.constants.W_OK);
        efs.promises.chmod(`${tempDir}/test`, 0o444).then(() => {
          efs.accessSync(`${tempDir}/test`, efs.constants.F_OK | efs.constants.R_OK);
          done();
        });
      });
    });

    // TODO: Is this necessary?
    // test('umask is correctly applied', () => {
    // 	const umask = 0o127
    // 	efs.writeFileSync(`${tempDir}/file`, 'hello world')
    // 	efs.mkdirSync(`${tempDir}/dir`)
    // 	efs.symlinkSync(`${tempDir}/file`, `${tempDir}/symlink`)
    // 	let stat: Stat
    // 	stat = efs.statSync(`${tempDir}/file`)
    // 	expect(stat.mode & (efs.constants.S_IRWXU | efs.constants.S_IRWXG | efs.constants.S_IRWXO)).toEqual(vfs.DEFAULT_FILE_PERM & (~umask))
    // 	stat = efs.statSync(`${tempDir}/dir`)
    // 	expect(stat.mode & (efs.constants.S_IRWXU | efs.constants.S_IRWXG | efs.constants.S_IRWXO)).toEqual(vfs.DEFAULT_DIRECTORY_PERM & (~umask))
    // 	// umask is not applied to symlinks
    // 	stat = efs.lstatSync(`${tempDir}/symlink`)
    // 	expect(stat.mode & (efs.constants.S_IRWXU | efs.constants.S_IRWXG | efs.constants.S_IRWXO)).toEqual(vfs.DEFAULT_SYMLINK_PERM)
    // })

    // test('non-root users can only chown uid if they own the file and they are chowning to themselves', () => {
    // 	efs.writeFileSync(`${tempDir}/file`, 'hello', {mode: 0o777})
    // 	efs.chownSync(`${tempDir}/file`, 1000, 1000)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.chownSync(`${tempDir}/file`, 1000, 1000)
    // 	// you cannot give away files
    // 	expect(() => {
    // 		efs.chownSync(`${tempDir}/file`, 2000, 2000)
    // 	}).toThrow('EPERM')
    // 	// if you don't own the file, you also cannot change (even if your change is noop)
    // 	efs.setUid(3000)
    // 	expect(() => {
    // 		efs.chownSync(`${tempDir}/file`, 1000, 1000)
    // 	}).toThrow('EPERM')
    // 	efs.setUid(1000)
    // 	efs.chownSync(`${tempDir}/file`, 1000, 2000)
    // })

    // test('chmod only works if you are the owner of the file - sync', () => {
    // 	efs.writeFileSync(`${tempDir}/file`, 'hello')
    // 	efs.chownSync(`${tempDir}/file`, 1000, 1000)
    // 	efs.setUid(1000)
    // 	efs.chmodSync(`${tempDir}/file`, 0o000)
    // 	efs.setUid(2000)

    // 	expect(() => {
    // 		efs.chmodSync(`${tempDir}/file`, 0o777)
    // 	}).toThrow('EPERM')
    // })

    // test('permissions are checked in stages of user, group then other - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.writeFileSync(`${tempDir}/testfile`, 'hello')
    // 	efs.mkdirSync(`${tempDir}/dir`)
    // 	efs.chmodSync(`${tempDir}/testfile`, 0o764)
    // 	efs.chmodSync(`${tempDir}/dir`, 0o764)
    // 	efs.accessSync(
    // 		`${tempDir}/testfile`,
    // 		(efs.constants.R_OK |
    // 		efs.constants.W_OK |
    // 		efs.constants.X_OK)
    // 	)
    // 	efs.accessSync(
    // 		`${tempDir}/dir`,
    // 		(efs.constants.R_OK |
    // 		efs.constants.W_OK |
    // 		efs.constants.X_OK)
    // 	)
    // 	efs.setUid(2000)
    // 	efs.accessSync(
    // 		`${tempDir}/testfile`,
    // 		(efs.constants.R_OK |
    // 		efs.constants.W_OK)
    // 	)
    // 	efs.accessSync(
    // 		`${tempDir}/dir`,
    // 		(efs.constants.R_OK |
    // 		efs.constants.W_OK)
    // 	)

    // 	expect(() => {
    // 		efs.accessSync(`${tempDir}/testfile`, efs.constants.X_OK)
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.accessSync(`${tempDir}/dir`, efs.constants.X_OK)
    // 	}).toThrow('EACCES')

    // 	efs.setGid(2000)
    // 	efs.accessSync(`${tempDir}/testfile`, efs.constants.R_OK)
    // 	efs.accessSync(`${tempDir}/dir`, efs.constants.R_OK)

    // 	expect(() => {
    // 		efs.accessSync(
    // 			`${tempDir}/testfile`,
    // 			(efs.constants.W_OK |
    // 			efs.constants.X_OK)
    // 		)
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.accessSync(
    // 			`${tempDir}/dir`,
    // 			(efs.constants.W_OK |
    // 			efs.constants.X_OK)
    // 		)
    // 	}).toThrow('EACCES')
    // })

    // test('permissions are checked in stages of user, group then other (using chownSync) - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.writeFileSync('testfile', 'hello')
    // 	efs.mkdirSync('dir')
    // 	efs.chmodSync('testfile', 0o764)
    // 	efs.chmodSync('dir', 0o764)
    // 	efs.accessSync(
    // 		'testfile',
    // 		(efs.constants.R_OK | efs.constants.W_OK | efs.constants.X_OK)
    // 	)
    // 	efs.accessSync(
    // 		'dir',
    // 		(efs.constants.R_OK | efs.constants.W_OK | efs.constants.X_OK)
    // 	)
    // 	efs.setUid(vfs.DEFAULT_ROOT_UID)
    // 	efs.setUid(vfs.DEFAULT_ROOT_GID)
    // 	efs.chownSync('testfile', 2000, 1000)
    // 	efs.chownSync('dir', 2000, 1000)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.accessSync(
    // 		'testfile',
    // 		(efs.constants.R_OK | efs.constants.W_OK)
    // 	)
    // 	efs.accessSync(
    // 		'dir',
    // 		(efs.constants.R_OK | efs.constants.W_OK)
    // 	)

    // 	expect(() => {
    // 		efs.accessSync('testfile', efs.constants.X_OK)
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.accessSync('dir', efs.constants.X_OK)
    // 	}).toThrow('EACCES')

    // 	efs.setUid(vfs.DEFAULT_ROOT_UID)
    // 	efs.setUid(vfs.DEFAULT_ROOT_GID)
    // 	efs.chownSync('testfile', 2000, 2000)
    // 	efs.chownSync('dir', 2000, 2000)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.accessSync('testfile', efs.constants.R_OK)
    // 	efs.accessSync('dir', efs.constants.R_OK)

    // 	expect(() => {
    // 		efs.accessSync(
    // 			'testfile',
    // 			(efs.constants.W_OK | efs.constants.X_OK)
    // 		)
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.accessSync(
    // 			'dir',
    // 			(efs.constants.W_OK | efs.constants.X_OK)
    // 		)
    // 	}).toThrow('EACCES')
    // })

    // test('--x-w-r-- do not provide read write and execute to the user due to permission staging', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.writeFileSync(`file`, 'hello')
    // 	efs.mkdirSync(`dir`)
    // 	efs.chmodSync(`file`, 0o124)
    // 	efs.chmodSync('dir', 0o124)

    // 	expect(() => {
    // 		efs.accessSync(
    // 			`file`,
    // 			(efs.constants.R_OK | efs.constants.W_OK)
    // 		)
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.accessSync(
    // 			`dir`,
    // 			(efs.constants.R_OK | efs.constants.W_OK)
    // 		)
    // 	}).toThrow('EACCES')

    // 	efs.accessSync(`file`, efs.constants.X_OK)
    // 	efs.accessSync('dir', efs.constants.X_OK)
    // })

    // test('file permissions --- - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.writeFileSync(`file`, 'hello')
    // 	efs.chmodSync(`file`, 0o000)

    // 	expect(() => {
    // 		efs.accessSync(`file`, efs.constants.X_OK)
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.openSync(`file`, 'r')
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.openSync(`file`, 'w')
    // 	}).toThrow('EACCES')

    // 	const stat = efs.statSync(`file`)
    // 	expect(stat.isFile()).toStrictEqual(true)
    // })

    // test('file permissions r-- - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	const str = 'hello'
    // 	efs.writeFileSync(`file`, str)
    // 	efs.chmodSync(`file`, 0o400)

    // 	expect(() => {
    // 		efs.accessSync(`file`, efs.constants.X_OK)
    // 	}).toThrow('EACCES')

    // 	expect(efs.readFileSync(`file`, {encoding: 'utf8'})).toEqual(str)

    // 	expect(() => {
    // 		efs.openSync(`file`, 'w')
    // 	}).toThrow('EACCES')
    // })

    // test('file permissions rw- - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.writeFileSync(`file`, 'world')
    // 	efs.chmodSync(`file`, 0o600)

    // 	expect(() => {
    // 		efs.accessSync(`file`, efs.constants.X_OK)
    // 	}).toThrow('EACCES')

    // 	const str = 'hello'
    // 	efs.writeFileSync(`file`, str)
    // 	expect(efs.readFileSync(`file`, {encoding: 'utf8'})).toEqual(str)
    // })

    // test('file permissions rwx - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.writeFileSync(`file`, 'world')
    // 	efs.chmodSync(`file`, 0o700)
    // 	efs.accessSync(`file`, efs.constants.X_OK)
    // 	const str = 'hello'
    // 	efs.writeFileSync(`file`, str)
    // 	expect(efs.readFileSync(`file`, {encoding: 'utf8'})).toEqual(str)
    // })

    // test('file permissions r-x - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	const str = 'hello'
    // 	efs.writeFileSync(`file`, str)
    // 	efs.chmodSync(`file`, 0o500)
    // 	efs.accessSync(`file`, efs.constants.X_OK)
    // 	expect(efs.readFileSync(`file`, {encoding: 'utf8'})).toEqual(str)
    // })

    // test('file permissions -w- - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	const str = 'hello'
    // 	efs.writeFileSync(`file`, str)
    // 	efs.chmodSync(`file`, 0o200)

    // 	expect(() => {
    // 		efs.accessSync(`file`, efs.constants.X_OK)
    // 	}).toThrow('EACCES')

    // 	efs.writeFileSync(`file`, str)

    // 	expect(() => {
    // 		const fd = efs.openSync(`file`, 'r')
    // 	}).toThrow('EACCES')
    // })

    // test('file permissions -wx - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	const str = 'hello'
    // 	efs.writeFileSync(`file`, str)
    // 	efs.chmodSync(`file`, 0o300)
    // 	efs.accessSync(`file`, efs.constants.X_OK)
    // 	efs.writeFileSync(`file`, str)

    // 	expect(() => {
    // 		const fd = efs.openSync(`file`, 'r')
    // 	}).toThrow('EACCES')
    // })

    // test('file permissions --x - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.writeFileSync(`file`, 'hello')
    // 	efs.chmodSync(`file`, 0o100)
    // 	efs.accessSync(`file`, efs.constants.X_OK)

    // 	expect(() => {
    // 		const fd = efs.openSync(`file`, 'w')
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		const fd = efs.openSync(`file`, 'r')
    // 	}).toThrow('EACCES')
    // })

    // test('directory permissions --- - sync', () => {
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.mkdirSync('---')
    // 	efs.chmodSync('---', 0o000)
    // 	const stat = efs.statSync('---')
    // 	expect(stat.isDirectory()).toStrictEqual(true)

    // 	expect(() => {
    // 		efs.writeFileSync('---/a', 'hello')
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.chdir('---')
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.readdirSync('---')
    // 	}).toThrow('EACCES')
    // })

    // test('directory permissions r-- - sync', () => {
    // 	// allows listing entries
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.mkdirSync('r--')
    // 	efs.writeFileSync('r--/a', 'hello')
    // 	efs.chmodSync('r--', 0o400)

    // 	expect(() => {
    // 		efs.writeFileSync('r--/b', 'hello')
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.chdir('r--')
    // 	}).toThrow('EACCES')
    // 	expect(efs.readdirSync('r--')).toEqual(['a'])
    // 	// you can always change metadata even without write permissions
    // 	efs.utimesSync('r--', new Date, new Date)
    // 	// you cannot access the properties of the children
    // 	expect(() => {
    // 		efs.statSync('r--/a')
    // 	}).toThrow('EACCES')
    // })

    // test('directory permissions rw- - sync', () => {
    // 	// allows listing entries
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.mkdirSync('rw-')
    // 	efs.writeFileSync('rw-/a', 'hello')
    // 	efs.chmodSync('rw-', 0o600)

    // 	// you cannot write into a file
    // 	expect(() => {
    // 		efs.writeFileSync('rw-/a', 'world')
    // 	}).toThrow('EACCES')

    // 	// you cannot create a new file
    // 	expect(() => {
    // 		efs.writeFileSync('rw-/b', 'hello')
    // 	}).toThrow('EACCES')
    // 	// you cannot remove files
    // 	expect(() => {
    // 		efs.unlinkSync('rw-/a')
    // 	}).toThrow('EACCES')
    // 	// you cannot traverse into it
    // 	expect(() => {
    // 		efs.chdir('rw-')
    // 	}).toThrow('EACCES')
    // 	expect(efs.readdirSync('rw-')).toEqual(['a'])
    // 	efs.utimesSync('rw-', new Date, new Date)
    // 	// you cannot access the properties of the children
    // 	expect(() => {
    // 		efs.statSync('rw-/a')
    // 	}).toThrow('EACCES')
    // })

    // test('directory permissions rwx - sync', () => {
    // 	// allows listing entries, creation of children and traversal
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.mkdirSync('rwx')
    // 	efs.chmodSync('rwx', 0o700)
    // 	const str = 'abc'
    // 	efs.writeFileSync('rwx/a', str)
    // 	expect(efs.readFileSync('rwx/a', {encoding: 'utf8'})).toEqual(str)
    // 	expect(efs.readdirSync('rwx')).toEqual(['a'])
    // 	efs.chdir('rwx')
    // 	const stat = efs.statSync('./a')
    // 	expect(stat.isFile()).toStrictEqual(true)
    // 	efs.unlinkSync('./a')
    // 	efs.rmdirSync('../rwx')
    // })

    // test('directory permissions r-x - sync', () => {
    // 	// allows listing entries and traversal
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.mkdirSync('r-x')
    // 	efs.mkdirSync('r-x/dir')
    // 	efs.writeFileSync('r-x/a', 'hello')
    // 	efs.chmodSync('r-x', 0o500)
    // 	const str = 'world'
    // 	// you can write to the file
    // 	efs.writeFileSync('r-x/a', str)

    // 	// you cannot create new files
    // 	expect(() => {
    // 		efs.writeFileSync('r-x/b', str)
    // 	}).toThrow('EACCES')
    // 	// you can read the directory
    // 	expect(efs.readdirSync('r-x')).toEqual(['dir', 'a'])
    // 	// you can read the file
    // 	expect(efs.readFileSync('r-x/a', {encoding: 'utf8'})).toEqual(str)
    // 	// you can traverse into the directory
    // 	efs.chdir('r-x')
    // 	const stat = efs.statSync('dir')
    // 	expect(stat.isDirectory()).toStrictEqual(true)
    // 	// you cannot delete the file
    // 	expect(() => {
    // 		efs.unlinkSync('./a')
    // 	}).toThrow('EACCES')
    // 	// cannot delete the directory
    // 	expect(() => {
    // 		efs.rmdirSync('dir')
    // 	}).toThrow('EACCES')
    // })

    // test('directory permissions -w- - sync', () => {
    // 	// allows nothing
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.mkdirSync('-w-')
    // 	efs.chmodSync('-w-', 0o000)

    // 	expect(() => {
    // 		efs.writeFileSync('-w-/a', 'hello')
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.chdir('-w-')
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.readdirSync('-w-')
    // 	}).toThrow('EACCES')
    // })

    // test('directory permissions -wx - sync', () => {
    // 	// creation of children and allows traversal
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.mkdirSync('-wx')
    // 	efs.chmodSync('-wx', 0o300)
    // 	const str = 'hello'
    // 	efs.writeFileSync('-wx/a', str)
    // 	expect(efs.readFileSync('-wx/a', {encoding: 'utf8'})).toEqual(str)
    // 	efs.unlinkSync('-wx/a')
    // 	efs.chdir('-wx')
    // 	efs.mkdirSync('./dir')

    // 	expect(() => {
    // 		efs.readdirSync('.')
    // 	}).toThrow('EACCES')

    // 	const stat = efs.statSync('./dir')
    // 	expect(stat.isDirectory()).toStrictEqual(true)
    // 	efs.rmdirSync('./dir')
    // })

    // test('directory permissions --x - sync', () => {
    // 	// allows traversal
    // 	efs.mkdirSync(`${tempDir}/home/1000`, {recursive: true})
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.mkdirSync('--x')
    // 	console.log(efs.getCwd())

    // 	const str = 'hello'
    // 	efs.writeFileSync('--x/a', str)
    // 	efs.chmodSync('--x', 0o100)
    // 	efs.chdir('--x')

    // 	expect(() => {
    // 		efs.writeFileSync('./b', 'world')
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.unlinkSync('./a')
    // 	}).toThrow('EACCES')
    // 	expect(() => {
    // 		efs.readdirSync('.')
    // 	}).toThrow('EACCES')

    // 	expect(efs.readFileSync('./a', {encoding: 'utf8'})).toEqual(str)
    // })

    // test('changing file permissions does not affect already opened file descriptor', () => {
    // 	// const efs = new vfs.VirtualFS
    // 	// efs.mkdirpSync(tempDir)
    // 	efs.mkdirpSync(`${tempDir}/home/1000`)
    // 	efs.chownSync(`${tempDir}/home/1000`, 1000, 1000)
    // 	efs.chdir(`${tempDir}/home/1000`)
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	const str = 'hello'
    // 	efs.writeFileSync(`file`, str)
    // 	efs.chmodSync(`file`, 0o777)
    // 	const fd = efs.openSync(`file`, 'r+')
    // 	efs.chmodSync(`file`, 0o000)
    // 	expect(efs.readFileSync(fd, {encoding: 'utf8'})).toEqual(str)
    // 	const str2 = 'world'
    // 	efs.writeFileSync(fd, str2)
    // 	efs.lseekSync(fd, 0)
    // 	expect(efs.readFileSync(fd, {encoding: 'utf8'})).toEqual(str2)
    // 	efs.closeSync(fd)
    // })

    // test('writeFileSync and appendFileSync respects the mode', () => {
    // 	// allow others to read only
    // 	efs.writeFileSync(`${tempDir}/test1`, '', { mode: 0o004 })
    // 	efs.appendFileSync(`${tempDir}/test2`, '', { mode: 0o004 })
    // 	// become the other
    // 	efs.setUid(1000)
    // 	efs.setGid(1000)
    // 	efs.accessSync(`${tempDir}/test1`, efs.constants.R_OK)
    // 	expect(() => {
    // 		efs.accessSync(`${tempDir}/test1`, efs.constants.W_OK)
    // 	}).toThrow('EACCES')

    // 	efs.accessSync(`${tempDir}/test2`, efs.constants.R_OK)
    // 	expect(() => {
    // 		efs.accessSync(`${tempDir}/test1`, efs.constants.W_OK)
    // 	}).toThrow('EACCES')
    // })
  });

  // /////////////////////////////
  // // Uint8Array data support //
  // /////////////////////////////
  // describe('Uint8Array data support', () => {
  // 	test('Uint8Array data support - sync', () => {
  // 		// const efs = new vfs.VirtualFS
  // 		// efs.mkdirpSync(tempDir)
  // 		const buffer = Buffer.from('abc')
  // 		const array = new Uint8Array(buffer)
  // 		efs.writeFileSync(`${tempDir}/a`, array)
  // 		expect(efs.readFileSync(`${tempDir}/a`, {})).toEqual(buffer)
  // 		const fd = efs.openSync(`${tempDir}/a`, 'r+')
  // 		efs.writeSync(fd, array)
  // 		efs.lseekSync(fd, 0)
  // 		const array2 = new Uint8Array(array.length)
  // 		efs.readSync(fd, array2, 0, array2.length)
  // 		expect(array2).toEqual(array)
  // 		efs.closeSync(fd)
  // 	})
  // })

  //////////////////////
  // URL path support //
  //////////////////////
  describe('URL path support', () => {
    // test('URL path support - sync', () => {
    // 	// const efs = new vfs.VirtualFS
    // 	let url: URL
    // 	url = new URL('file:///file')
    // 	const str = 'Hello World'
    // 	efs.writeFileSync(url, str)
    // 	expect(efs.readFileSync(url, {encoding: 'utf8'})).toEqual(str)
    // 	const fd = efs.openSync(url, 'a+')
    // 	const str2 = 'abc'
    // 	efs.writeSync(fd, str2)
    // 	const buffer = Buffer.allocUnsafe(str.length + str2.length)
    // 	efs.lseekSync(fd, 0)
    // 	efs.readSync(fd, buffer, 0, buffer.length)
    // 	expect(buffer).toEqual(Buffer.from(str + str2))
    // 	url = new URL('file://hostname/file')
    // 	expect(() => {
    // 		efs.openSync(url, 'w')
    // 	}).toThrow('ERR_INVALID_FILE_URL_HOST')
    // 	efs.closeSync(fd)
    // })
  });

  //////////////////////////
  // Open, read and write //
  //////////////////////////
  describe('Open, read and write tests', () => {
    test('open - sync', () => {
      const filename = `${tempDir}/test`;
      efs.writeFileSync(filename, 'something interesting');
      let fd = efs.openSync(filename, 'w+');
      expect(typeof fd).toEqual('number');
    });

    test('open - async', (done) => {
      const filename = `${tempDir}/test`;
      efs.writeFileSync(filename, 'something interesting');
      expect.assertions(1);
      efs.promises.open(filename, 'r')
        .then((fd) => {
          expect(typeof fd).toEqual('number');
          done();
        })
        .catch((err) => {
          expect(err).toBeNull();
        });
    });

    test('write - sync', () => {
      let fd = efs.openSync(`${tempDir}/test.txt`, 'w+');
      const writeBuf = Buffer.from('Super confidential information');
      efs.writeSync(fd, writeBuf);
    });

    test('write then read - single block', () => {
      let fd = efs.openSync(`${tempDir}/test.txt`, 'w+');

      const writeBuffer = Buffer.from('Super confidential information');

      const bytesWritten = efs.writeSync(fd, writeBuffer);

      expect(bytesWritten).toEqual(writeBuffer.length);

      let readBuffer = Buffer.alloc(writeBuffer.length);

      const bytesRead = efs.readSync(fd, readBuffer);

      expect(bytesRead).toEqual(bytesWritten);

      expect(writeBuffer).toStrictEqual(readBuffer);
    });

    test('write then read - multiple blocks', () => {
      let fd = efs.openSync(`${tempDir}/test.txt`, 'w+');

      const blockSize = 4096;

      // Write data
      const writeBuffer = Buffer.from(crypto.randomBytes(blockSize * 3));
      const bytesWritten = efs.writeSync(fd, writeBuffer);

      expect(bytesWritten).toEqual(writeBuffer.length);

      // Read data back
      let readBuffer = Buffer.alloc(writeBuffer.length);
      const bytesRead = efs.readSync(fd, readBuffer);

      expect(bytesRead).toEqual(bytesWritten);

      expect(writeBuffer).toStrictEqual(readBuffer);
    });

    test('write non-zero position - middle of start block - with text buffer', () => {
      const blockSize = 4096;

      // Define file descriptor
      const filename = `${tempDir}/test_middle_text.txt`;
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
      let readBuffer = Buffer.alloc(blockSize);
      efs.readSync(fd, readBuffer, 0, readBuffer.length, 0);

      middleData.copy(writeBuffer, middlePosition);
      const expected = writeBuffer;

      expect(expected).toStrictEqual(readBuffer);
    });

    test('write non-zero position - middle of start block', () => {
      const blockSize = 4096;

      // write a three block file
      const writeBuffer = crypto.randomBytes(blockSize * 3);
      const filename = `${tempDir}/test_middle.txt`;
      const fd = efs.openSync(filename, 'w+');
      efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0);

      // write data in the middle
      const middlePosition = 2000;
      const middleText = 'Malcom in the';
      const middleData = Buffer.from(middleText);
      efs.writeSync(fd, middleData, 0, middleData.length, middlePosition);

      // re-read the blocks
      let readBuffer = Buffer.alloc(blockSize * 3);
      efs.readSync(fd, readBuffer, 0, readBuffer.length, 0);

      middleData.copy(writeBuffer, middlePosition);
      const expected = writeBuffer;

      expect(expected).toStrictEqual(readBuffer);
    });

    test('write non-zero position - middle of middle block', () => {
      const blockSize = 4096;

      // write a three block file
      const writeBuffer = crypto.randomBytes(blockSize * 3);
      const filename = `${tempDir}/test_middle.txt`;
      let fd = efs.openSync(filename, 'w+');
      efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0);

      // write data in the middle
      const middlePosition = blockSize + 2000;
      const middleData = Buffer.from('Malcom in the');
      efs.writeSync(fd, middleData, 0, middleData.length, middlePosition);

      // re-read the blocks
      let readBuffer = Buffer.alloc(blockSize * 3);
      fd = efs.openSync(filename);
      efs.readSync(fd, readBuffer, 0, readBuffer.length, 0);

      middleData.copy(writeBuffer, middlePosition);
      const expected = writeBuffer;

      expect(readBuffer).toEqual(expected);
    });

    test('write non-zero position - middle of end block', () => {
      const blockSize = 4096;

      // write a three block file
      const writePos = 2 * blockSize + 2000;
      const writeBuffer = crypto.randomBytes(blockSize * 3);
      const fd = efs.openSync(`${tempDir}/test_middle.txt`, 'w+');
      efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0);

      // write data in the middle
      const middleData = Buffer.from('Malcom in the');
      efs.writeSync(fd, middleData, 0, middleData.length, writePos);

      // re-read the blocks
      let readBuffer = Buffer.alloc(blockSize * 3);
      efs.readSync(fd, readBuffer, 0, readBuffer.length, 0);

      middleData.copy(writeBuffer, writePos);
      const expected = writeBuffer;

      expect(readBuffer).toEqual(expected);
    });

    test('write segment spanning across two block', () => {
      const blockSize = 4096;

      // write a three block file
      const writeBuffer = crypto.randomBytes(blockSize * 3);
      const fd = efs.openSync(`${tempDir}/test_middle.txt`, 'w+');
      efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0);

      // write data in the middle
      const writePos = 4090;
      const middleData = Buffer.from('Malcom in the');
      efs.writeSync(fd, middleData, 0, middleData.length, writePos);

      // re-read the blocks
      let readBuffer = Buffer.alloc(blockSize * 3);
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
    let efsTempDir: string;
    let fsTempDir: string;
    beforeEach(() => {
      efsTempDir = `${tempDir}/efs`;
      fsTempDir = `${tempDir}/fs`;
      efs.mkdirSync(efsTempDir);
      fs.mkdirSync(fsTempDir);
    });

    describe('one set of read/write operations', () => {
      describe('one set of read/write operations - 1 block', () => {
        test('one set of read/write operations - 1 block - full block aligned', () => {
          // case: |<---------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer);
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer);
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('one set of read/write operations - 1 block - left block aligned', () => {
          // case: |<-------->--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, 0, 3000, 0);
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, 0, 3000, 0);
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('one set of read/write operations - 1 block - right block aligned', () => {
          // case: |--<-------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, 1000, 3096, 1000);
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 1000, 3096, 1000);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, 1000, 3096, 1000);
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 1000, 3096, 1000);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('one set of read/write operations - 1 block - not block aligned', () => {
          // case: |--<------>--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, 1000, 2000, 1000);
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 1000, 2000, 1000);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, 1000, 2000, 1000);
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 1000, 2000, 1000);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });
      });
      describe('one set of read/write operations - 2 block', () => {
        test('one set of read/write operations - 2 block - full block aligned', () => {
          // case: |<---------->|<---------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer);
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer);
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('one set of read/write operations - 2 block - left block aligned', () => {
          // case: |<---------->|<-------->--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, 0, 6000, 0);
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, 0, 6000, 0);
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('one set of read/write operations - 2 block - right block aligned', () => {
          // case: |--<-------->|<---------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            1000,
            2 * blockSize - 1000,
            1000,
          );
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 1000, 2 * blockSize - 1000, 1000);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, 1000, 2 * blockSize - 1000, 1000);
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 1000, 2 * blockSize - 1000, 1000);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('one set of read/write operations - 2 block - not block aligned', () => {
          // case: |--<-------->|<-------->--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, 1000, 6000, 1000);
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 1000, 6000, 1000);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, 1000, 6000, 1000);
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 1000, 6000, 1000);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });
      });
      describe('one set of read/write operations - 3 block', () => {
        test('one set of read/write operations - 3 block - full block aligned', () => {
          // case: |<---------->|<---------->|<---------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer);
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer);
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('one set of read/write operations - 3 block - left block aligned', () => {
          // case: |<---------->|<---------->|<-------->--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, 0, 2 * blockSize + 1000, 0);
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, 0, 2 * blockSize + 1000, 0);
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('one set of read/write operations - 3 block - right block aligned', () => {
          // case: |--<-------->|<---------->|<---------->|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            1000,
            3 * blockSize - 1000,
            1000,
          );
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 1000, 3 * blockSize - 1000, 1000);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, 1000, 3 * blockSize - 1000, 1000);
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 1000, 3 * blockSize - 1000, 1000);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('one set of read/write operations - 3 block - not block aligned', () => {
          // case: |--<-------->|<---------->|<-------->--|
          const blockSize = 4096;
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          // efs
          const efsFilename = `${efsTempDir}/file`;
          const efsFd = efs.openSync(efsFilename, 'w+');
          const efsFirstBytesWritten = efs.writeSync(
            efsFd,
            firstWriteBuffer,
            1000,
            2 * blockSize + 1000,
            1000,
          );
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 1000, 2 * blockSize + 1000, 1000);

          // fs
          const fsFilename = `${fsTempDir}/file`;
          const fsFd = fs.openSync(fsFilename, 'w+');
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, 1000, 2 * blockSize + 1000, 1000);
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 1000, 2 * blockSize + 1000, 1000);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });
      });
    });

    describe('read/write operations on existing 3 block file', () => {
      let efsFd: number;
      let fsFd: number;
      const blockSize = 20;

      beforeEach(() => {
        // Write 3 block file
        // case: |<---------->|<---------->|<---------->|
        const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
        // efs
        const efsFilename = `${efsTempDir}/file`;
        efsFd = efs.openSync(efsFilename, 'w+');
        efs.writeSync(efsFd, firstWriteBuffer);

        // fs
        const fsFilename = `${fsTempDir}/file`;
        fsFd = fs.openSync(fsFilename, 'w+');
        fs.writeSync(fsFd, firstWriteBuffer);
      });

      describe('read/write operations on existing 3 block file - one set of read/write operations - 1 block', () => {
        test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - full block aligned', () => {
          // case: |<---------->|<==========>|<==========>|
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          const offset = 0;
          const length = blockSize;
          const position = 0;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - left block aligned', () => {
          // case: |<-------->==|<==========>|<==========>|
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          const offset = 0;
          const length = Math.ceil(blockSize * 0.8);
          const position = 0;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - right block aligned', () => {
          // case: |==<-------->|<==========>|<==========>|
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = blockSize - offset;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 1 block - not block aligned', () => {
          // case: |==<------>==|<==========>|<==========>|
          const firstWriteBuffer = crypto.randomBytes(blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = Math.ceil(blockSize * 0.6);
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });
      });
      describe('read/write operations on existing 3 block file - one set of read/write operations - 2 block', () => {
        test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - full block aligned', () => {
          // case: |<---------->|<---------->|<==========>|
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          const offset = 0;
          const length = 2 * blockSize;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - left block aligned', () => {
          // case: |<---------->|<-------->==|<==========>|
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          const offset = 0;
          const length = blockSize + Math.ceil(blockSize * 0.8);
          const position = 0;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, efsFirstReadBuffer.length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, fsFirstReadBuffer.length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - right block aligned', () => {
          // case: |==<-------->|<---------->|<==========>|
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = 2 * blockSize - offset;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 2 block - not block aligned', () => {
          // case: |==<-------->|<-------->==|<==========>|
          const firstWriteBuffer = crypto.randomBytes(2 * blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = 2 * (blockSize - offset);
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(2 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });
      });
      describe('read/write operations on existing 3 block file - one set of read/write operations - 3 block', () => {
        test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - full block aligned', () => {
          // case: |<---------->|<---------->|<---------->|
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          const offset = 0;
          const length = 3 * blockSize;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - left block aligned', () => {
          // case: |<---------->|<---------->|<-------->==|
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          const offset = 0;
          const length = 3 * blockSize - Math.ceil(blockSize * 0.2);
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, 0, efsFirstReadBuffer.length, 0);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, 0, fsFirstReadBuffer.length, 0);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - right block aligned', () => {
          // case: |==<-------->|<---------->|<---------->|
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = 3 * blockSize - offset;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });

        test('read/write operations on existing 3 block file - one set of read/write operations - 3 block - not block aligned', () => {
          // case: |==<-------->|<---------->|<-------->==|
          const firstWriteBuffer = crypto.randomBytes(3 * blockSize);
          const offset = Math.ceil(blockSize * 0.2);
          const length = 3 * blockSize - 2 * offset;
          const position = offset;
          // efs
          const efsFirstBytesWritten = efs.writeSync(efsFd, firstWriteBuffer, offset, length, position);
          const efsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          efs.readSync(efsFd, efsFirstReadBuffer, offset, length, position);

          // fs
          const fsFirstBytesWritten = fs.writeSync(fsFd, firstWriteBuffer, offset, length, position);
          const fsFirstReadBuffer = Buffer.alloc(3 * blockSize);
          fs.readSync(fsFd, fsFirstReadBuffer, offset, length, position);

          // Comparison
          expect(efsFirstBytesWritten).toEqual(fsFirstBytesWritten);
          expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
        });
      });
    });

    describe('readFile/writeFile operations', () => {
      const blockSize = 4096;

      test('readFile/writeFile operations - under block size', () => {
        const firstWriteBuffer = crypto.randomBytes(Math.ceil(blockSize * Math.random()));
        // efs
        const efsFilename = `${efsTempDir}/file`;
        efs.writeFileSync(efsFilename, firstWriteBuffer);
        const efsFirstReadBuffer = efs.readFileSync(efsFilename);

        // fs
        const fsFilename = `${fsTempDir}/file`;
        fs.writeFileSync(fsFilename, firstWriteBuffer);
        const fsFirstReadBuffer = fs.readFileSync(fsFilename);

        // Comparison
        expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
      });

      test('readFile/writeFile operations - over block size', () => {
        const firstWriteBuffer = crypto.randomBytes(Math.ceil(blockSize + blockSize * Math.random()));
        // efs
        const efsFilename = `${efsTempDir}/file`;
        efs.writeFileSync(efsFilename, firstWriteBuffer);
        const efsFirstReadBuffer = efs.readFileSync(efsFilename);

        // fs
        const fsFilename = `${fsTempDir}/file`;
        fs.writeFileSync(fsFilename, firstWriteBuffer);
        const fsFirstReadBuffer = fs.readFileSync(fsFilename);

        // Comparison
        expect(efsFirstReadBuffer).toEqual(fsFirstReadBuffer);
      });
    });
  });
});
