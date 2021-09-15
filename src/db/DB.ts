import type { AbstractBatch } from 'abstract-leveldown';
import type { LevelDB } from 'level';
import type { MutexInterface } from 'async-mutex';
import type { DBDomain, DBLevel, DBOps, DBTransaction } from './types';
import type { Callback, FileSystem } from '../types';

import level from 'level';
import subleveldown from 'subleveldown';
import { Transfer } from 'threads';
import { Mutex } from 'async-mutex';
import Logger from '@matrixai/logger';
import Transaction from './Transaction';
import * as dbUtils from './utils';
import * as dbErrors from './errors';
import { WorkerManager } from '../workers';
import { maybeCallback } from '../utils';

class DB {
  public static async createDB({
    dbKey,
    dbPath,
    lock = new Mutex(),
    fs = require('fs'),
    logger = new Logger(this.name),
  }: {
    dbKey: Buffer;
    dbPath: string;
    lock?: MutexInterface;
    fs?: FileSystem;
    logger?: Logger;
  }) {
    const db = new DB({
      dbKey,
      dbPath,
      lock,
      fs,
      logger,
    });
    await db.start();
    return db;
  }

  public readonly dbPath: string;

  protected dbKey: Buffer;
  protected lock: MutexInterface;
  protected fs: FileSystem;
  protected logger: Logger;
  protected workerManager?: WorkerManager;
  protected _db: LevelDB<string | Buffer, Buffer>;
  protected _started: boolean = false;
  protected _destroyed: boolean = false;

  protected constructor({
    dbKey,
    dbPath,
    lock,
    fs,
    logger,
  }: {
    dbKey: Buffer;
    dbPath: string;
    lock: MutexInterface;
    fs: FileSystem;
    logger: Logger;
  }) {
    this.logger = logger;
    this.dbKey = dbKey;
    this.dbPath = dbPath;
    this.lock = lock;
    this.fs = fs;
  }

  get db(): LevelDB<string, Buffer> {
    return this._db;
  }

  get locked(): boolean {
    return this.lock.isLocked();
  }

  get started(): boolean {
    return this._started;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  public async start(): Promise<void>;
  public async start(callback: Callback): Promise<void>;
  public async start(callback?: Callback): Promise<void> {
    return maybeCallback(
      async () =>
        this.withLocks(async () => {
          if (this._started) {
            return;
          }
          if (this._destroyed) {
            throw new dbErrors.ErrorDBDestroyed();
          }
          this.logger.info('Starting DB');
          this.logger.info(`Setting DB path to ${this.dbPath}`);
          try {
            await this.fs.promises.mkdir(this.dbPath, { recursive: true });
          } catch (e) {
            if (e.code !== 'EEXIST') {
              throw e;
            }
          }
          const dbLevel = await new Promise<LevelDB<string | Buffer, Buffer>>(
            (resolve, reject) => {
              const db = level(
                this.dbPath,
                {
                  keyEncoding: 'binary',
                  valueEncoding: 'binary',
                },
                (e) => {
                  if (e) {
                    reject(e);
                  } else {
                    resolve(db);
                  }
                },
              );
            },
          );
          this._db = dbLevel;
          this._started = true;
          this.logger.info('Started DB');
        }),
      callback,
    );
  }

  public async stop(): Promise<void>;
  public async stop(callback: Callback): Promise<void>;
  public async stop(callback?: Callback): Promise<void> {
    return maybeCallback(
      async () =>
        this.withLocks(async () => {
          if (!this._started) {
            return;
          }
          this.logger.info('Stopping DB');
          await this.db.close();
          this._started = false;
          this.logger.info('Stopped DB');
        }),
      callback,
    );
  }

  public async destroy(): Promise<void>;
  public async destroy(callback: Callback): Promise<void>;
  public async destroy(callback?: Callback): Promise<void> {
    return maybeCallback(
      async () =>
        this.withLocks(async () => {
          if (this.destroyed) {
            return;
          }
          if (this._started) {
            throw new dbErrors.ErrorDBStarted();
          }
          await this.fs.promises.rm(this.dbPath, { recursive: true });
          this._destroyed = true;
        }),
      callback,
    );
  }

  public setWorkerManager(workerManager: WorkerManager) {
    this.workerManager = workerManager;
  }

  public unsetWorkerManager() {
    delete this.workerManager;
  }

  public async withLocks<T>(
    f: () => Promise<T>,
    locks: Array<MutexInterface> = [this.lock],
  ): Promise<T> {
    const releases: Array<MutexInterface.Releaser> = [];
    for (const l of locks) {
      releases.push(await l.acquire());
    }
    try {
      return await f();
    } finally {
      // Release them in the opposite order
      releases.reverse();
      for (const r of releases) {
        r();
      }
    }
  }

  /**
   * Attempts to lock in sequence
   * If you don't pass any
   * Then it will just lock globally
   * Otherwise it tries to run the transaction
   * And commits the operations at the very end
   * This allows one to create a lock to be shared between mutliple transactions
   */
  public async transact<T>(
    f: (t: DBTransaction) => Promise<T>,
    locks: Array<MutexInterface> = [this.lock],
  ): Promise<T> {
    return this.withLocks(async () => {
      if (!this._started) {
        throw new dbErrors.ErrorDBNotStarted();
      }
      const tran = new Transaction({ db: this, logger: this.logger });
      let value: T;
      try {
        value = await f(tran);
        await tran.commit();
      } catch (e) {
        await tran.rollback();
        throw e;
      }
      // Only finalize if commit succeeded
      await tran.finalize();
      return value;
    }, locks);
  }

  public async level(domain: string, dbLevel?: DBLevel): Promise<DBLevel>;
  public async level(
    domain: string,
    callback: Callback<[DBLevel]>,
  ): Promise<void>;
  public async level(
    domain: string,
    dbLevel: DBLevel,
    callback: Callback<[DBLevel]>,
  ): Promise<void>;
  public async level(
    domain: string,
    dbLevelOrCallback: DBLevel | Callback<[DBLevel]> = this._db,
    callback?: Callback<[DBLevel]>,
  ): Promise<DBLevel | void> {
    const dbLevel =
      typeof dbLevelOrCallback !== 'function' ? dbLevelOrCallback : this._db;
    callback =
      typeof dbLevelOrCallback === 'function' ? dbLevelOrCallback : callback;
    return maybeCallback(async () => {
      if (!this._started) {
        throw new dbErrors.ErrorDBNotStarted();
      }
      try {
        return new Promise<DBLevel>((resolve) => {
          const dbLevelNew = subleveldown(dbLevel, domain, {
            keyEncoding: 'binary',
            valueEncoding: 'binary',
            open: (cb) => {
              cb(undefined);
              resolve(dbLevelNew);
            },
          });
        });
      } catch (e) {
        if (e instanceof RangeError) {
          // Some domain prefixes will conflict with the separator
          throw new dbErrors.ErrorDBLevelPrefix();
        }
        throw e;
      }
    }, callback);
  }

  public async count(dbLevel?: DBLevel): Promise<number>;
  public async count(callback: Callback<[number]>): Promise<void>;
  public async count(
    dbLevel: DBLevel,
    callback: Callback<[number]>,
  ): Promise<void>;
  public async count(
    dbLevelOrCallback: DBLevel | Callback<[number]> = this._db,
    callback?: Callback<[number]>,
  ): Promise<number | void> {
    const dbLevel =
      typeof dbLevelOrCallback !== 'function' ? dbLevelOrCallback : this._db;
    callback =
      typeof dbLevelOrCallback === 'function' ? dbLevelOrCallback : callback;
    return maybeCallback(async () => {
      if (!this._started) {
        throw new dbErrors.ErrorDBNotStarted();
      }
      let count = 0;
      for await (const _k of dbLevel.createKeyStream()) {
        count++;
      }
      return count;
    }, callback);
  }

  public async get<T>(
    domain: DBDomain,
    key: string | Buffer,
    raw?: false,
  ): Promise<T | undefined>;
  public async get<_T>(
    domain: DBDomain,
    key: string | Buffer,
    raw: true,
  ): Promise<Buffer | undefined>;
  public async get<T>(
    domain: DBDomain,
    key: string | Buffer,
    callback: Callback<[T | undefined]>,
  ): Promise<void>;
  public async get<T>(
    domain: DBDomain,
    key: string | Buffer,
    raw: false,
    callback: Callback<[T | undefined]>,
  ): Promise<void>;
  public async get<_T>(
    domain: DBDomain,
    key: string | Buffer,
    raw: true,
    callback: Callback<[Buffer | undefined]>,
  ): Promise<void>;
  public async get<T>(
    domain: DBDomain,
    key: string | Buffer,
    rawOrCallback: boolean | Callback<[T | Buffer | undefined]> = false,
    callback?: Callback<[T | Buffer | undefined]>,
  ): Promise<T | Buffer | undefined | void> {
    const raw = typeof rawOrCallback !== 'function' ? rawOrCallback : false;
    callback = typeof rawOrCallback === 'function' ? rawOrCallback : callback;
    return maybeCallback(async () => {
      if (!this._started) {
        throw new dbErrors.ErrorDBNotStarted();
      }
      let data;
      try {
        data = await this._db.get(dbUtils.domainPath(domain, key));
      } catch (e) {
        if (e.notFound) {
          return undefined;
        }
        throw e;
      }
      return this.deserializeDecrypt<T>(data, raw as any);
    }, callback);
  }

  public async put(
    domain: DBDomain,
    key: string | Buffer,
    value: any,
    raw?: false,
  ): Promise<void>;
  public async put(
    domain: DBDomain,
    key: string | Buffer,
    value: Buffer,
    raw: true,
  ): Promise<void>;
  public async put(
    domain: DBDomain,
    key: string | Buffer,
    value: any,
    callback: Callback,
  ): Promise<void>;
  public async put(
    domain: DBDomain,
    key: string | Buffer,
    value: any,
    raw: false,
    callback: Callback,
  ): Promise<void>;
  public async put(
    domain: DBDomain,
    key: string | Buffer,
    value: Buffer,
    raw: true,
    callback: Callback,
  ): Promise<void>;
  public async put(
    domain: DBDomain,
    key: string | Buffer,
    value: any,
    rawOrCallback: boolean | Callback = false,
    callback?: Callback,
  ): Promise<void> {
    const raw = typeof rawOrCallback !== 'function' ? rawOrCallback : false;
    callback = typeof rawOrCallback === 'function' ? rawOrCallback : callback;
    return maybeCallback(async () => {
      if (!this._started) {
        throw new dbErrors.ErrorDBNotStarted();
      }
      const data = await this.serializeEncrypt(value, raw as any);
      return this._db.put(dbUtils.domainPath(domain, key), data);
    }, callback);
  }

  public async del(domain: DBDomain, key: string | Buffer): Promise<void>;
  public async del(
    domain: DBDomain,
    key: string | Buffer,
    callback: Callback,
  ): Promise<void>;
  public async del(
    domain: DBDomain,
    key: string | Buffer,
    callback?: Callback,
  ): Promise<void> {
    return maybeCallback(async () => {
      if (!this._started) {
        throw new dbErrors.ErrorDBNotStarted();
      }
      return this._db.del(dbUtils.domainPath(domain, key));
    }, callback);
  }

  public async batch(ops: Readonly<DBOps>): Promise<void>;
  public async batch(ops: Readonly<DBOps>, callback: Callback): Promise<void>;
  public async batch(ops: Readonly<DBOps>, callback?: Callback): Promise<void> {
    return maybeCallback(async () => {
      if (!this._started) {
        throw new dbErrors.ErrorDBNotStarted();
      }
      const ops_: Array<AbstractBatch> = [];
      for (const op of ops) {
        if (op.type === 'del') {
          ops_.push({
            type: op.type,
            key: dbUtils.domainPath(op.domain, op.key),
          });
        } else if (op.type === 'put') {
          const data = await this.serializeEncrypt(
            op.value,
            (op.raw === true) as any,
          );
          ops_.push({
            type: op.type,
            key: dbUtils.domainPath(op.domain, op.key),
            value: data,
          });
        }
      }
      return this._db.batch(ops_);
    }, callback);
  }

  public async serializeEncrypt(value: any, raw: false): Promise<Buffer>;
  public async serializeEncrypt(value: Buffer, raw: true): Promise<Buffer>;
  public async serializeEncrypt(
    value: any,
    raw: false,
    callback: Callback<[Buffer]>,
  ): Promise<void>;
  public async serializeEncrypt(
    value: Buffer,
    raw: true,
    callback: Callback<[Buffer]>,
  ): Promise<void>;
  public async serializeEncrypt(
    value: any | Buffer,
    raw: boolean,
    callback?: Callback<[Buffer]>,
  ): Promise<Buffer | void> {
    return maybeCallback(async () => {
      const plainText: Buffer = raw
        ? (value as Buffer)
        : dbUtils.serialize(value);
      if (this.workerManager != null) {
        return this.workerManager.call(async (w) => {
          const [cipherBuf, cipherOffset, cipherLength] =
            await w.encryptWithKey(
              Transfer(this.dbKey.buffer),
              this.dbKey.byteOffset,
              this.dbKey.byteLength,
              // @ts-ignore: No easy fix for now.
              Transfer(plainText.buffer),
              plainText.byteOffset,
              plainText.byteLength,
            );
          return Buffer.from(cipherBuf, cipherOffset, cipherLength);
        });
      } else {
        return dbUtils.encryptWithKey(this.dbKey, plainText);
      }
    }, callback);
  }

  public async deserializeDecrypt<T>(
    cipherText: Buffer,
    raw: false,
  ): Promise<T>;
  public async deserializeDecrypt<_T>(
    cipherText: Buffer,
    raw: true,
  ): Promise<Buffer>;
  public async deserializeDecrypt<T>(
    cipherText: Buffer,
    raw: false,
    callback: Callback<[T]>,
  ): Promise<void>;
  public async deserializeDecrypt<_T>(
    cipherText: Buffer,
    raw: true,
    callback: Callback<[Buffer]>,
  ): Promise<void>;
  public async deserializeDecrypt<T>(
    cipherText: Buffer,
    raw: boolean,
    callback?: Callback<[T | Buffer]>,
  ): Promise<T | Buffer | void> {
    return maybeCallback(async () => {
      let plainText;
      if (this.workerManager != null) {
        plainText = await this.workerManager.call(async (w) => {
          const decrypted = await w.decryptWithKey(
            Transfer(this.dbKey.buffer),
            this.dbKey.byteOffset,
            this.dbKey.byteLength,
            // @ts-ignore: No easy fix for now.
            Transfer(cipherText.buffer),
            cipherText.byteOffset,
            cipherText.byteLength,
          );
          if (decrypted != null) {
            return Buffer.from(decrypted[0], decrypted[1], decrypted[2]);
          } else {
            return;
          }
        });
      } else {
        plainText = dbUtils.decryptWithKey(this.dbKey, cipherText);
      }
      if (plainText == null) {
        throw new dbErrors.ErrorDBDecrypt();
      }
      return raw ? plainText : dbUtils.deserialize<T>(plainText);
    }, callback);
  }
}

export default DB;
