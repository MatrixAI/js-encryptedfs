import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import * as vfs from 'virtualfs';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import * as utils from '@/utils';
import EncryptedFS from '@/EncryptedFS';
import { EncryptedFSError, errno } from '@/EncryptedFSError';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import { expectError, sleep } from "./utils";
import { Readable, Writable } from 'readable-stream';
import { WriteStream } from "@/streams";

describe('EncryptedFS Streams', () => {
  const logger = new Logger('EncryptedFS Streams', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let dbPath: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
  let iNodeMgr: INodeManager;
  const devMgr = new vfs.DeviceManager();
  let efs: EncryptedFS;
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      pathNode.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    dbPath = `${dataDir}/db`;
    db = await DB.createDB({
      dbKey,
      dbPath,
      logger,
    });
    await db.start();
    iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger,
    });
    efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
  });
  afterEach(async () => {
    await db.stop();
    await db.destroy();
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  describe('readstream', () => {
    test('using \'for await\'', async () => {
      const str = 'Hello';
      await efs.writeFile(`/test`, str);
      const readable = await efs.createReadStream(`/test`, {
        encoding: 'utf8',
        start: 0,
        end: str.length - 1,
      });
      let readString = '';
      for await (const data of readable) {
        readString += data;
      }
      expect(readString).toBe(str);
    });
    test('using \'event readable\'', async (done) => {
      const str = 'Hello';
      await efs.writeFile(`/test`, str);
      const readable = await efs.createReadStream(`/test`, {
        encoding: 'utf8',
        start: 0,
        end: str.length - 1,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
          data += chunk;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str);
        done();
      });
    });
    test('using \'event data\'', async (done) => {
      const str = 'Hello';
      await efs.writeFile(`/test`, str);
      const readable = await efs.createReadStream(`/test`, {
        encoding: 'utf8',
        start: 0,
        end: str.length - 1,
      });
      let data = '';
      readable.on('data', (chunk) => {
        data += chunk;
      });
      readable.on('end', () => {
        expect(data).toBe(str);
        done();
      });
    });
    test('respects start and end options', async (done) => {
      const str = 'Hello';
      await efs.writeFile(`file`, str, { encoding: 'utf8' });
      const readable = await efs.createReadStream(`file`, {
        encoding: 'utf8',
        start: 1,
        end: 3,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
          data += chunk;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str.slice(1, 4));
        done();
      });
    });
    test('respects the high watermark', async (done) => {
      const str = 'Hello';
      const highWatermark = 2;
      await efs.writeFile(`file`, str, { encoding: 'utf8' });
      const readable = await efs.createReadStream(`file`, {
        encoding: 'utf8',
        highWaterMark: highWatermark,
      });
      let chunk;
      let counter = 0;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
          expect(chunk).toBe(str.slice(counter, counter + highWatermark));
          data += chunk;
          counter += highWatermark;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str);
        done();
      });
    });
    test('respects the start option', async (done) => {
      const str = 'Hello';
      const filePath = `file`;
      const offset = 1;
      await efs.writeFile(filePath, str, { encoding: 'utf8' });
      const readable = await efs.createReadStream(filePath, {
        encoding: 'utf8',
        start: offset,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
          data += chunk;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str.slice(offset));
        done();
      });
    });
    test('end option is ignored without the start option', async (done) => {
      const str = 'Hello';
      const filePath = `file`;
      await efs.writeFile(filePath, str);
      const readable = await efs.createReadStream(filePath, {
        encoding: 'utf8',
        end: 1,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
          data += chunk;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str);
        done();
      });
    });
    test('can use a file descriptor', async (done) => {
      const str = 'Hello';
      const filePath = `file`;
      await efs.writeFile(filePath, str);
      const fd = await efs.open(filePath, 'r');
      const offset = 1;
      await efs.lseek(fd, offset);
      const readable = await efs.createReadStream('', {
        encoding: 'utf8',
        fd: fd,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
          data += chunk;
        }
      });
      readable.on('end', () => {
        expect(data).toBe(str.slice(offset));
        done();
      });
    });
    test('with start option overrides the file descriptor position', async (done) => {
      const str = 'Hello';
      await efs.writeFile(`file`, str);
      const fd = await efs.open(`file`, 'r');
      const offset = 1;
      const readable = await efs.createReadStream('', {
        encoding: 'utf8',
        fd: fd,
        start: offset,
      });
      let chunk;
      let data = '';
      readable.on('readable', () => {
        while ((chunk = readable.read()) != null) {
          data += chunk;
        }
      });
      readable.on('end', async () => {
        expect(data).toBe(str.slice(offset));
        const buf = Buffer.allocUnsafe(1);
        await efs.read(fd, buf, 0, buf.length);
        expect(buf.toString('utf8')).toBe(str.slice(0, buf.length));
        done();
      });
    });
    test('can handle errors asynchronously', async (done) => {
      const stream = await efs.createReadStream(`file`);
      stream.on('error', (err) => {
        expect(err instanceof Error).toBe(true);
        const error = err as any;
        expect(error.code).toBe('ENOENT');
        done();
      });
      stream.read(10);
    });
    test('can compose with pipes', async (done) => {
      const str = 'Hello';
      await efs.writeFile(`file`, str);
      const readStream = await efs.createReadStream(`file`, {
        encoding: 'utf8',
        end: 10,
      });
      // Creating a test writable stream.
      let data = '';
      class TestWritable extends Writable {
        constructor() {
          super();
        }
        _write(chunk, encoding, callback) {
          data += chunk.toString();
          callback();
        }
      }

      const testWritable = new TestWritable();
      readStream.pipe(testWritable);
      testWritable.on('finish', () => {
        expect(data).toEqual(str);
        done();
      });
    });
  });
  describe('writestream', () => {
    test('can compose with pipes', async (done) => {
      const message = 'Hello there kenobi';
      const str = '';
      await efs.writeFile(`file`, str);

      const writeStream = await efs.createWriteStream('file', {
        encoding: 'utf8',
      });

      class TestReadableStream extends Readable {
        written = false;
        constructor() {
          super();
        }
        _read(size) {
          if (!this.written) {
            this.push(message);
            this.written = true;
          } else {
            this.push(null);
          }
        }
      }

      const testReadableStream = new TestReadableStream();
      testReadableStream.pipe(writeStream);
      writeStream.on('finish', async () => {
        const data = await efs.readFile('file');
        expect(data.toString()).toEqual(message);
        done();
      });
    });
    test('can create and truncate files', async (done) => {
      const str = 'Hello';
      const fileName = `file`;
      const writable = await efs.createWriteStream(fileName, {});
      writable.end(str, async () => {
        const readStr = await efs.readFile(fileName, { encoding: 'utf-8' });
        expect(readStr).toEqual(str);
        const truncateWritable = await efs.createWriteStream(fileName, {});
        truncateWritable.end('', async () => {
          const readStr = await efs.readFile(fileName, { encoding: 'utf-8' });
          expect(readStr).toEqual('');
          done();
        });
      });
    });
    test('can be written into', async (done) => {
      const str = 'Hello';
      const stream = await efs.createWriteStream('file');
      stream.write(Buffer.from(str));
      stream.end();
      stream.on('finish', async () => {
        const readStr = await efs.readFile('file', { encoding: 'utf-8' });
        expect(readStr).toEqual(str);
        done();
      });
    });
    test('allow ignoring of the drain event, temporarily ignoring resource usage control', async (done) => {
      const waterMark = 10;
      const writable = await efs.createWriteStream('file', {
        highWaterMark: waterMark,
      });
      const buf = Buffer.allocUnsafe(waterMark).fill(97);
      const times = 4;
      for (let i = 0; i < times; ++i) {
        expect(writable.write(buf)).toBe(false);
      }
      writable.end(async () => {
        const readStr = await efs.readFile('file', { encoding: 'utf8' });
        expect(readStr).toBe(buf.toString().repeat(times));
        done();
      });
    });
    test('can use the drain event to manage resource control', async (done) => {
      const waterMark = 10;
      const writable = await efs.createWriteStream('file', {
        highWaterMark: waterMark,
      });
      const buf = Buffer.allocUnsafe(waterMark).fill(97);
      let times = 10;
      const timesOrig = times;
      const writing = () => {
        let status;
        do {
          status = writable.write(buf);
          times -= 1;
          if (times === 0) {
            writable.end(async () => {
              const readStr = await efs.readFile('file', { encoding: 'utf8' });
              expect(readStr).toBe(buf.toString().repeat(timesOrig));
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
    test('can handle errors asynchronously', async (done) => {
      const fileName = `file/unknown`;
      const writable = await efs.createWriteStream(fileName);
      // note that it is possible to have the finish event occur before the error event
      writable.once('error', (err) => {
        expect(err instanceof Error).toBe(true);
        const error = err as any;
        expect(error.code).toBe('ENOENT');
        done();
      });
      writable.end();
    });
    test('Two write streams to the same file', async () => {
      const contentSize = 4096 * 3;
      const contents = [
        'A'.repeat(contentSize),
        'B'.repeat(contentSize),
        'C'.repeat(contentSize),
      ]
      let streams: Array<WriteStream> = [];

      // Each stream sequentially.
      for (let i = 0; i < contents.length; i++) {
        streams.push(await efs.createWriteStream('file'))
      }
      for (let i = 0; i < streams.length; i++) {
        streams[i].write(Buffer.from(contents[i]));
      }
      for (const stream of streams) {
        stream.end();
      }

      await sleep(1000);
      const fileContents = (await efs.readFile('file')).toString()
      expect(fileContents).not.toContain('A');
      expect(fileContents).not.toContain('B');
      expect(fileContents).toContain('C');

      await efs.unlink('file');

      // Each stream interlaced.
      const contents2 = [
        'A'.repeat(4096),
        'B'.repeat(4096),
        'C'.repeat(4096),
      ]
      streams = [];
      for (let i = 0; i < contents2.length; i++) {
        streams.push(await efs.createWriteStream('file'))
      }
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < streams.length; i++) {
          // Order we write to changes.
          streams[(j + i) % 3].write(Buffer.from(contents2[(j + i) % 3]));
        }
      }
      for (const stream of streams) {
        stream.end();
      }
      await sleep(1000);
      const fileContents2 = (await efs.readFile('file')).toString()
      expect(fileContents2).not.toContain('A');
      expect(fileContents2).not.toContain('B');
      expect(fileContents2).toContain('C');
      // Conclusion. the last stream to close writes the whole contents of it's buffer to the file.
    })
  });
  test('Read stream and write stream to same file', async () => {
    await efs.writeFile('file', '');
    const readStream = await efs.createReadStream('file');
    const writeStream = await efs.createWriteStream('file', {flags: 'w+'});
    const contents = 'A'.repeat(4096);

    //Write two blocks.
    writeStream.write(Buffer.from(contents));
    // writeStream.end();
    await sleep(1000);
    let readString = '';
    for await (const data of readStream) {
      readString += data;
    }
    expect(readString.length).toEqual(4096);
    writeStream.end();

    // writeStream.write(Buffer.from(contents));
    // await sleep(1000);
    //
    // for await (const data of readStream) {
    //   readString += data;
    // }
    // expect(readString.length).toEqual(4096);
  })
});
