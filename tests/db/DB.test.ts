import type { DBOp } from '@/db/types';

import os from 'os';
import path from 'path';
import fs from 'fs';
import lexi from 'lexicographic-integer';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { DB } from '@/db';
import * as utils from '@/utils';

describe('DB', () => {
  const logger = new Logger('DB Test', LogLevel.WARN, [new StreamHandler()]);
  let dataDir: string;
  let dbKey: Buffer;
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    dbKey = await utils.generateKey(256);
  });
  afterEach(async () => {
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test('async construction constructs the db leveldb', async () => {
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    const dbPathContents = await fs.promises.readdir(dbPath);
    expect(dbPathContents.length).toBeGreaterThan(1);
    await db.stop();
  });
  test(
    'get and put and del',
    async () => {
      const dbPath = `${dataDir}/db`;
      const db = await DB.createDB({ dbKey, dbPath, logger });
      await db.start();
      await db.db.clear();
      await db.put([], 'a', 'value0');
      expect(await db.get([], 'a')).toBe('value0');
      await db.del([], 'a');
      expect(await db.get([], 'a')).toBeUndefined();
      await db.level('level1');
      await db.put(['level1'], 'a', 'value1');
      expect(await db.get(['level1'], 'a')).toBe('value1');
      await db.del(['level1'], 'a');
      expect(await db.get(['level1'], 'a')).toBeUndefined();
      await db.stop();
    },
    global.defaultTimeout * 2,
  );
  test('db levels are leveldbs', async () => {
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    await db.start();
    await db.db.put('a', await db.serializeEncrypt('value0', false));
    expect(await db.get([], 'a')).toBe('value0');
    await db.put([], 'b', 'value0');
    expect(await db.deserializeDecrypt(await db.db.get('b'), false)).toBe(
      'value0',
    );
    const level1 = await db.level('level1');
    await level1.put('a', await db.serializeEncrypt('value1', false));
    expect(await db.get(['level1'], 'a')).toBe('value1');
    await db.put(['level1'], 'b', 'value1');
    expect(await db.deserializeDecrypt(await level1.get('b'), false)).toBe(
      'value1',
    );
    await db.stop();
  });
  test('db levels are just ephemeral abstractions', async () => {
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    await db.start();
    // there's no need to actually create a sublevel instance
    // if you are always going to directly use the root
    // however it is useful if you need to iterate over a sublevel
    // plus you do not need to "destroy" a sublevel
    // clearing the entries is sufficient
    await db.put(['level1'], 'a', 'value1');
    expect(await db.get(['level1'], 'a')).toBe('value1');
    await db.del(['level1'], 'a');
    expect(await db.get(['level1'], 'a')).toBeUndefined();
    await db.stop();
  });
  test('db levels are facilitated by key prefixes', async () => {
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    await db.start();
    const level1 = await db.level('level1');
    const level2a = await db.level('100', level1);
    const level2b = await db.level('200', level1);
    let count;
    // expect level1 to be empty
    count = 0;
    for await (const k of level1.createKeyStream()) {
      count++;
    }
    expect(count).toBe(0);
    await level2a.put('a', await db.serializeEncrypt('value1', false));
    await level2b.put('b', await db.serializeEncrypt('value2', false));
    // there should be 2 entries at level1
    // because there is 1 entry for each sublevel
    count = 0;
    let keyToTest: string;
    for await (const k of level1.createKeyStream()) {
      // all keys are buffers
      keyToTest = k.toString('utf-8');
      count++;
    }
    expect(count).toBe(2);
    // it is possible to access sublevel entries from the upper level
    const valueToTest = await db.get<string>(['level1'], keyToTest!);
    expect(valueToTest).toBeDefined();
    // the level separator is set to `!`
    expect(keyToTest!).toBe('!200!b');
    await db.stop();
  });
  test('clearing a db level clears all sublevels', async () => {
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    await db.start();
    const level1 = await db.level('level1');
    await db.level('level2', level1);
    await db.put([], 'a', 'value0');
    await db.put(['level1'], 'a', 'value1');
    await db.put(['level1', 'level2'], 'a', 'value2');
    expect(await db.get([], 'a')).toBe('value0');
    expect(await db.get(['level1'], 'a')).toBe('value1');
    expect(await db.get(['level1', 'level2'], 'a')).toBe('value2');
    await level1.clear();
    expect(await db.get([], 'a')).toBe('value0');
    expect(await db.get(['level1'], 'a')).toBeUndefined();
    expect(await db.get(['level1', 'level2'], 'a')).toBeUndefined();
    await db.stop();
  });
  test('lexicographic iteration order', async () => {
    // leveldb stores keys in lexicographic order
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    await db.start();
    // sorted order [ 'AQ', 'L', 'Q', 'fP' ]
    const keys = ['Q', 'fP', 'AQ', 'L'];
    for (const k of keys) {
      await db.put([], k, 'value');
    }
    const keysIterated: Array<string> = [];
    for await (const k of db.db.createKeyStream()) {
      // keys are buffers due to key encoding
      keysIterated.push(k.toString('utf-8'));
    }
    expect(keys).not.toEqual(keysIterated);
    expect(keys.sort()).toEqual(keysIterated);
    await db.stop();
  });
  test('lexicographic integer iteration', async () => {
    // using the lexicographic-integer encoding
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    await db.start();
    // sorted order should be [3, 4, 42, 100]
    const keys = [100, 3, 4, 42];
    for (const k of keys) {
      await db.put([], Buffer.from(lexi.pack(k)), 'value');
    }
    const keysIterated: Array<number> = [];
    for await (const k of db.db.createKeyStream()) {
      // keys are buffers due to key encoding
      keysIterated.push(lexi.unpack([...k]));
    }
    expect(keys).not.toEqual(keysIterated);
    // numeric sort
    expect(keys.sort((a, b) => a - b)).toEqual(keysIterated);
    await db.stop();
  });
  test('db level lexicographic iteration', async () => {
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    await db.start();
    const level1 = await db.level('level1');
    const keys1 = ['Q', 'fP', 'AQ', 'L'];
    for (const k of keys1) {
      await level1.put(k, await db.serializeEncrypt('value1', false));
    }
    const keysIterated1: Array<string> = [];
    for await (const k of level1.createKeyStream()) {
      // keys are buffers due to key encoding
      keysIterated1.push(k.toString('utf-8'));
    }
    expect(keys1).not.toEqual(keysIterated1);
    expect(keys1.sort()).toEqual(keysIterated1);
    const level2 = await db.level('level2');
    const keys2 = [100, 3, 4, 42];
    for (const k of keys2) {
      await level2.put(
        Buffer.from(lexi.pack(k)),
        await db.serializeEncrypt('value2', false),
      );
    }
    const keysIterated2: Array<number> = [];
    for await (const k of level2.createKeyStream()) {
      // keys are buffers due to key encoding
      keysIterated2.push(lexi.unpack([...k]));
    }
    expect(keys2).not.toEqual(keysIterated2);
    // numeric sort
    expect(keys2.sort((a, b) => a - b)).toEqual(keysIterated2);
    await db.stop();
  });
  test('get and put and del on string and buffer keys', async () => {
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    await db.start();
    await db.db.clear();
    // 'string' is the same as Buffer.from('string')
    // even across levels
    await db.put([], 'string', 'value1');
    expect(await db.get([], 'string')).toBe('value1');
    expect(await db.get([], Buffer.from('string'))).toBe('value1');
    await db.del([], 'string');
    expect(await db.get([], 'string')).toBeUndefined();
    expect(await db.get([], Buffer.from('string'))).toBeUndefined();
    // now using buffer keys across levels that are always strings
    await db.level('level1');
    await db.put(['level1'], 'string', 'value2');
    expect(await db.get(['level1'], 'string')).toBe('value2');
    // level1 has been typed to use string keys
    // however the reality is that you can always use buffer keys
    // since strings and buffers get turned into buffers
    // so we can use buffer keys starting from root
    // we use this key type to enforce opaque types that are actually strings or buffers
    expect(await db.get(['level1'], Buffer.from('string'))).toBe('value2');
    await db.del(['level1'], Buffer.from('string'));
    expect(await db.get(['level1'], 'string')).toBeUndefined();
    expect(await db.get(['level1'], Buffer.from('string'))).toBeUndefined();
    await db.stop();
  });
  // test('get and put and del callback style', (done) => {
  //   const dbPath = `${dataDir}/db`;
  //   const db = DB.createDB({ dbKey, dbPath, logger });
  //   db.start((e) => {
  //     expect(e).toBeNull();
  //     db.put([], 'a', 'value0', () => {
  //       expect(e).toBeNull();
  //       db.get([], 'a', (_, value) => {
  //         expect(value).toBe('value0');
  //         db.del([], 'a', (e) => {
  //           expect(e).toBeNull();
  //           db.get([], 'a', (e, value) => {
  //             expect(e).toBeNull();
  //             expect(value).toBeUndefined();
  //             db.level('level1', (e) => {
  //               expect(e).toBeNull();
  //               db.put(['level1'], 'a', 'value1', () => {
  //                 db.get(['level1'], 'a', (e, value) => {
  //                   expect(e).toBeNull();
  //                   expect(value).toBe('value1');
  //                   db.del(['level1'], 'a', () => {
  //                     db.get(['level1'], 'a', (_, value) => {
  //                       expect(value).toBeUndefined();
  //                       db.stop(() => {
  //                         done();
  //                       })
  //                     });
  //                   });
  //                 });
  //               });
  //             });
  //           });
  //         });
  //       });
  //     });
  //   });
  // });
  // test('level callback style', (done) => {
  //   const dbPath = `${dataDir}/db`;
  //   const db = await DB.createDB({ dbKey, dbPath, logger });
  //   db.start((e) => {
  //     expect(e).toBeNull();
  //     db.level('level1', (e, level1) => {
  //       expect(e).toBeNull();
  //       db.level('level2', level1, (e, level2) => {
  //         expect(e).toBeNull();
  //         expect(level2).toBeDefined();
  //         db.stop((e) => {
  //           expect(e).toBeNull();
  //           done();
  //         });
  //       });
  //     });
  //   });
  // });
  // test('batch callback style', (done) => {
  //   const dbPath = `${dataDir}/db`;
  //   const db = await DB.createDB({ dbKey, dbPath, logger });
  //   db.start((e) => {
  //     expect(e).toBeNull();
  //     const ops: Array<DBOp> = [
  //       {
  //         type: 'put',
  //         domain: [],
  //         key: 'a',
  //         value: 'something'
  //       },
  //       {
  //         type: 'put',
  //         domain: [],
  //         key: 'b',
  //         value: 'something'
  //       },
  //       {
  //         type: 'del',
  //         domain: [],
  //         key: 'a'
  //       }
  //     ];
  //     db.batch(ops, (e) => {
  //       expect(e).toBeNull();
  //       db.get([], 'a', (e, value) => {
  //         expect(e).toBeNull();
  //         expect(value).toBeUndefined();
  //         db.get([], 'b', (e, value) => {
  //           expect(e).toBeNull();
  //           expect(value).toBe('something');
  //           db.stop((e) => {
  //             expect(e).toBeNull();
  //             done();
  //           });
  //         });
  //       });
  //     });
  //   });
  // });
  test('streams can be consumed with promises', async () => {
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    await db.start();
    await db.put([], 'a', 'value0');
    await db.put([], 'b', 'value1');
    await db.put([], 'c', 'value2');
    await db.put([], 'd', 'value3');
    const keyStream = db.db.createKeyStream();
    const ops = await new Promise<Array<DBOp>>((resolve, reject) => {
      const ops: Array<DBOp> = [];
      keyStream.on('data', (k) => {
        ops.push({
          type: 'del',
          domain: [],
          key: k,
        });
      });
      keyStream.on('end', () => {
        resolve(ops);
      });
      keyStream.on('error', (e) => {
        reject(e);
      });
    });
    // here we batch up the deletion
    await db.batch(ops);
    expect(await db.get([], 'a')).toBeUndefined();
    expect(await db.get([], 'b')).toBeUndefined();
    expect(await db.get([], 'c')).toBeUndefined();
    expect(await db.get([], 'd')).toBeUndefined();
    await db.stop();
  });
  test('counting sublevels', async () => {
    const dbPath = `${dataDir}/db`;
    const db = await DB.createDB({ dbKey, dbPath, logger });
    await db.start();
    await db.put([], 'a', 'value0');
    await db.put([], 'b', 'value1');
    await db.put([], 'c', 'value2');
    await db.put([], 'd', 'value3');
    await db.put(['level1'], 'a', 'value0');
    await db.put(['level1'], 'b', 'value1');
    await db.put(['level1'], 'c', 'value2');
    await db.put(['level1'], 'd', 'value3');
    await db.put(['level1', 'level11'], 'a', 'value0');
    await db.put(['level1', 'level11'], 'b', 'value1');
    await db.put(['level1', 'level11'], 'c', 'value2');
    await db.put(['level1', 'level11'], 'd', 'value3');
    await db.put(['level2'], 'a', 'value0');
    await db.put(['level2'], 'b', 'value1');
    await db.put(['level2'], 'c', 'value2');
    await db.put(['level2'], 'd', 'value3');
    const level1 = await db.level('level1');
    const level11 = await db.level('level11', level1);
    const level2 = await db.level('level2');
    expect(await db.count(level1)).toBe(8);
    expect(await db.count(level11)).toBe(4);
    expect(await db.count(level2)).toBe(4);
    expect(await db.count()).toBe(16);
    await db.stop();
  });
});
