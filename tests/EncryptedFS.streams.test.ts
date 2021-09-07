import os, { constants } from 'os';
import fs from 'fs';
import pathNode from 'path';
import process from 'process';
import * as vfs from 'virtualfs';
import Logger, { StreamHandler, LogLevel } from '@matrixai/logger';
import * as utils from '@/utils';
import EncryptedFS from '@/EncryptedFS';
import { EncryptedFSError, errno } from '@/EncryptedFSError';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import { expectError } from './utils';
import { WriteStream } from "@/streams";
import { Readable, Writable } from "readable-stream";

describe('EncryptedFS Streams', () => {
  const logger = new Logger('EncryptedFS Test', LogLevel.WARN, [
    new StreamHandler(),
  ]);
  // const cwd = process.cwd();
  let dataDir: string;
  let dbPath: string;
  let db: DB;
  const dbKey: Buffer = utils.generateKeySync(256);
  let iNodeMgr: INodeManager;
  const devMgr = new vfs.DeviceManager();
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
  });
  afterEach(async () => {
    await db.stop();
    await db.destroy();
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test("readstream usage - 'for await'", async () => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test("readstream usage - 'event readable'", async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test("readstream usage - 'event data'", async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('readstreams respect start and end options', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('readstreams respect the high watermark', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('readstream respects the start option', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('readstream end option is ignored without the start option', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('readstream can use a file descriptor', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('readstream with start option overrides the file descriptor position', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('readstreams handle errors asynchronously', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    const stream = await efs.createReadStream(`file`);
    stream.on('error', (err) => {
      expect(err instanceof Error).toBe(true);
      const error = err as any;
      expect(error.code).toBe('ENOENT');
      done();
    });
    stream.read(10);
  });
  test('readstreams can compose with pipes', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
    })
  });
  test('writestreams can compose with pipes', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
    const message = 'Hello there kenobi';
    const str = '';
    await efs.writeFile(`file`, str);

    const writeStream = await efs.createWriteStream('file', {
      encoding: 'utf8',
    } )

    class TestReadableStream extends Readable{
      written = false;
      constructor(){
        super();
      }
      _read(size) {
        if(!this.written) {
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
      const data = await efs.readFile('file')
      expect(data.toString()).toEqual(message);
      done();
    })
  });
  test('writestream can create and truncate files', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('writestream can be written into', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('writestreams allow ignoring of the drain event, temporarily ignoring resource usage control', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('writestreams can use the drain event to manage resource control', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
  test('writestreams handle errors asynchronously', async (done) => {
    const efs = await EncryptedFS.createEncryptedFS({
      dbKey,
      dbPath,
      db,
      devMgr,
      iNodeMgr,
      umask: 0o022,
      logger,
    });
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
});
