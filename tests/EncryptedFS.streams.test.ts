import os from 'os';
import fs from 'fs';
import pathNode from 'path';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import { Readable, Writable } from 'readable-stream';
import EncryptedFS from '@/EncryptedFS';
import * as utils from '@/utils';
import { promise } from '@/utils';

describe('EncryptedFS Streams', () => {
  const logger = new Logger('EncryptedFS Streams', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  let dataDir: string;
  let dbPath: string;
  const dbKey: Buffer = utils.generateKeySync(256);
  let efs: EncryptedFS;
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      pathNode.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    dbPath = `${dataDir}/db`;
    efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      umask: 0o022,
      logger,
    });
  });
  afterEach(async () => {
    await efs.stop();
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  describe('readstream', () => {
    test("using 'for await'", async () => {
      const str = 'Hello';
      await efs.writeFile(`/test`, str);
      const readable = efs.createReadStream(`/test`, {
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
    test("using 'event readable'", async () => {
      const str = 'Hello';
      await efs.writeFile(`/test`, str);
      const readable = efs.createReadStream(`/test`, {
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
      const ended = promise<void>();
      readable.on('end', () => {
        expect(data).toBe(str);
        ended.resolveP();
      });
      await ended.p;
    });
    test("using 'event data'", async () => {
      const str = 'Hello';
      await efs.writeFile(`/test`, str);
      const readable = efs.createReadStream(`/test`, {
        encoding: 'utf8',
        start: 0,
        end: str.length - 1,
      });
      let data = '';
      readable.on('data', (chunk) => {
        data += chunk;
      });
      const ended = promise<void>();
      readable.on('end', () => {
        expect(data).toBe(str);
        ended.resolveP();
      });
      await ended.p;
    });
    test('respects start and end options', async () => {
      const str = 'Hello';
      await efs.writeFile(`file`, str, { encoding: 'utf8' });
      const readable = efs.createReadStream(`file`, {
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
      const ended = promise<void>();
      readable.on('end', () => {
        expect(data).toBe(str.slice(1, 4));
        ended.resolveP();
      });
      await ended.p;
    });
    test('respects the high watermark', async () => {
      const str = 'Hello';
      const highWatermark = 2;
      await efs.writeFile(`file`, str, { encoding: 'utf8' });
      const readable = efs.createReadStream(`file`, {
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
      const ended = promise<void>();
      readable.on('end', () => {
        expect(data).toBe(str);
        ended.resolveP();
      });
      await ended.p;
    });
    test('respects the start option', async () => {
      const str = 'Hello';
      const filePath = `file`;
      const offset = 1;
      await efs.writeFile(filePath, str, { encoding: 'utf8' });
      const readable = efs.createReadStream(filePath, {
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
      const ended = promise<void>();
      readable.on('end', () => {
        expect(data).toBe(str.slice(offset));
        ended.resolveP();
      });
      await ended.p;
    });
    test('end option is ignored without the start option', async () => {
      const str = 'Hello';
      const filePath = `file`;
      await efs.writeFile(filePath, str);
      const readable = efs.createReadStream(filePath, {
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
      const ended = promise<void>();
      readable.on('end', () => {
        expect(data).toBe(str);
        ended.resolveP();
      });
      await ended.p;
    });
    test('can use a file descriptor', async () => {
      const str = 'Hello';
      const filePath = `file`;
      await efs.writeFile(filePath, str);
      const fd = await efs.open(filePath, 'r');
      const offset = 1;
      await efs.lseek(fd, offset);
      const readable = efs.createReadStream('', {
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
      const ended = promise<void>();
      readable.on('end', () => {
        expect(data).toBe(str.slice(offset));
        ended.resolveP();
      });
      await ended.p;
    });
    test('with start option overrides the file descriptor position', async () => {
      const str = 'Hello';
      await efs.writeFile(`file`, str);
      const fd = await efs.open(`file`, 'r');
      const offset = 1;
      const readable = efs.createReadStream('', {
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
      const ended = promise<void>();
      readable.on('end', async () => {
        expect(data).toBe(str.slice(offset));
        const buf = Buffer.allocUnsafe(1);
        await efs.read(fd, buf, 0, buf.length);
        expect(buf.toString('utf8')).toBe(str.slice(0, buf.length));
        ended.resolveP();
      });
      await ended.p;
    });
    test('can handle errors asynchronously', async () => {
      const stream = efs.createReadStream(`file`);
      const ended = promise<void>();
      stream.on('error', (err) => {
        expect(err instanceof Error).toBe(true);
        const error = err as any;
        expect(error.code).toBe('ENOENT');
        ended.resolveP();
      });
      stream.read(10);
      await ended.p;
    });
    test('can compose with pipes', async () => {
      const str = 'Hello';
      await efs.writeFile(`file`, str);
      const readStream = efs.createReadStream(`file`, {
        encoding: 'utf8',
        end: 10,
      });
      // Creating a test writable stream
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

      const ended = promise<void>();
      const testWritable = new TestWritable();
      // @ts-ignore: This works but problem with types
      readStream.pipe(testWritable);
      testWritable.on('finish', () => {
        expect(data).toEqual(str);
        ended.resolveP();
      });
      await ended.p;
    });
  });
  describe('writestream', () => {
    test('can compose with pipes', async () => {
      const message = 'Hello there kenobi';
      const str = '';
      await efs.writeFile(`file`, str);

      const writeStream = efs.createWriteStream('file', {
        encoding: 'utf8',
      });

      class TestReadableStream extends Readable {
        written = false;
        constructor() {
          super();
        }
        _read() {
          if (!this.written) {
            this.push(message);
            this.written = true;
          } else {
            this.push(null);
          }
        }
      }

      const ended = promise<void>();
      const testReadableStream = new TestReadableStream();
      // @ts-ignore: This works but problem with types
      testReadableStream.pipe(writeStream);
      writeStream.on('finish', async () => {
        const data = await efs.readFile('file');
        expect(data.toString()).toEqual(message);
        ended.resolveP();
      });
      await ended.p;
    });
    test('can create and truncate files', async () => {
      const str = 'Hello';
      const fileName = `file`;
      const ended = promise<void>();
      const writable = efs.createWriteStream(fileName, {});
      writable.end(str, async () => {
        const readStr = await efs.readFile(fileName, { encoding: 'utf-8' });
        expect(readStr).toEqual(str);
        const truncateWritable = efs.createWriteStream(fileName, {});
        truncateWritable.end('', async () => {
          const readStr = await efs.readFile(fileName, { encoding: 'utf-8' });
          expect(readStr).toEqual('');
          ended.resolveP();
        });
      });
      await ended.p;
    });
    test('can be written into', async () => {
      const str = 'Hello';
      const stream = efs.createWriteStream('file');
      stream.write(Buffer.from(str));
      stream.end();
      const ended = promise<void>();
      stream.on('finish', async () => {
        const readStr = await efs.readFile('file', { encoding: 'utf-8' });
        expect(readStr).toEqual(str);
        ended.resolveP();
      });
      await ended.p;
    });
    test('allow ignoring of the drain event, temporarily ignoring resource usage control', async () => {
      const waterMark = 10;
      const writable = efs.createWriteStream('file', {
        highWaterMark: waterMark,
      });
      const buf = Buffer.allocUnsafe(waterMark).fill(97);
      const times = 4;
      for (let i = 0; i < times; ++i) {
        expect(writable.write(buf)).toBe(false);
      }
      const ended = promise<void>();
      writable.end(async () => {
        const readStr = await efs.readFile('file', { encoding: 'utf8' });
        expect(readStr).toBe(buf.toString().repeat(times));
        ended.resolveP();
      });
      await ended.p;
    });
    test('can use the drain event to manage resource control', async () => {
      const waterMark = 10;
      const writable = efs.createWriteStream('file', {
        highWaterMark: waterMark,
      });
      const buf = Buffer.allocUnsafe(waterMark).fill(97);
      let times = 10;
      const timesOrig = times;
      const ended = promise<void>();
      const writing = () => {
        let status;
        do {
          status = writable.write(buf);
          times -= 1;
          if (times === 0) {
            writable.end(async () => {
              const readStr = await efs.readFile('file', { encoding: 'utf8' });
              expect(readStr).toBe(buf.toString().repeat(timesOrig));
              ended.resolveP();
            });
          }
        } while (times > 0 && status);
        if (times > 0) {
          writable.once('drain', writing);
        }
      };
      writing();
      await ended.p;
    });
    test('can handle errors asynchronously', async () => {
      const fileName = `file/unknown`;
      const writable = efs.createWriteStream(fileName);
      // Note that it is possible to have the finish event occur before the error event
      const ended = promise<void>();
      writable.once('error', (err) => {
        expect(err instanceof Error).toBe(true);
        const error = err as any;
        expect(error.code).toBe('ENOENT');
        ended.resolveP();
      });
      writable.end();
      await ended.p;
    });
  });
});
