import type { AbstractBatch } from 'abstract-leveldown';
import type { LevelDB } from 'level';
import type { MutexInterface } from 'async-mutex';
import type { DBDomain, DBLevel, DBOps, DBTransaction } from './types';
import type { EFSWorkerManagerInterface } from '../workers';
import type { FileSystem } from '../types';

import level from 'level';
import subleveldown from 'subleveldown';
import { Transfer } from 'threads';
import { Mutex } from 'async-mutex';
import Logger from '@matrixai/logger';
import Transaction from './Transaction';
import * as dbUtils from './utils';
import * as dbErrors from './errors';
import * as utils from '../utils';

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
  protected workerManager?: EFSWorkerManagerInterface;
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

  public async start(): Promise<void> {
    return this.withLocks(async () => {
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
    });
  }

  public async stop(): Promise<void> {
    return this.withLocks(async () => {
      if (!this._started) {
        return;
      }
      this.logger.info('Stopping DB');
      await this.db.close();
      this._started = false;
      this.logger.info('Stopped DB');
    });
  }

  public async destroy(): Promise<void> {
    return this.withLocks(async () => {
      if (this.destroyed) {
        return;
      }
      if (this._started) {
        throw new dbErrors.ErrorDBStarted();
      }
      await this.fs.promises.rm(this.dbPath, { recursive: true });
      this._destroyed = true;
    });
  }

  public setWorkerManager(workerManager: EFSWorkerManagerInterface) {
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

  public async level(
    domain: string,
    dbLevel: DBLevel = this._db,
  ): Promise<DBLevel> {
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
  }

  public async count(dbLevel: DBLevel = this._db): Promise<number> {
    if (!this._started) {
      throw new dbErrors.ErrorDBNotStarted();
    }
    let count = 0;
    for await (const _ of dbLevel.createKeyStream()) {
      count++;
    }
    return count;
  }

  public async get<T>(
    domain: DBDomain,
    key: string | Buffer,
    raw?: false,
  ): Promise<T | undefined>;
  public async get(
    domain: DBDomain,
    key: string | Buffer,
    raw: true,
  ): Promise<Buffer | undefined>;
  public async get<T>(
    domain: DBDomain,
    key: string | Buffer,
    raw: boolean = false,
  ): Promise<T | undefined> {
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
    raw: boolean = false,
  ): Promise<void> {
    if (!this._started) {
      throw new dbErrors.ErrorDBNotStarted();
    }
    const data = await this.serializeEncrypt(value, raw as any);
    return this._db.put(dbUtils.domainPath(domain, key), data);
  }

  public async del(domain: DBDomain, key: string | Buffer): Promise<void> {
    if (!this._started) {
      throw new dbErrors.ErrorDBNotStarted();
    }
    return this._db.del(dbUtils.domainPath(domain, key));
  }

  public async batch(ops: Readonly<DBOps>): Promise<void> {
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
  }

  public async serializeEncrypt(value: any, raw: false): Promise<Buffer>;
  public async serializeEncrypt(value: Buffer, raw: true): Promise<Buffer>;
  public async serializeEncrypt(
    value: any | Buffer,
    raw: boolean,
  ): Promise<Buffer> {
    const plainTextBuf: Buffer = raw
      ? (value as Buffer)
      : dbUtils.serialize(value);
    if (this.workerManager != null) {
      return this.workerManager.call(async (w) => {
        const dbKey = utils.toArrayBuffer(this.dbKey);
        const plainText = utils.toArrayBuffer(plainTextBuf);
        const cipherText = await w.efsEncryptWithKey(
          Transfer(dbKey),
          // @ts-ignore: threads.js types are wrong
          Transfer(plainText),
        );
        return utils.fromArrayBuffer(cipherText);
      });
    } else {
      return utils.encryptWithKey(this.dbKey, plainTextBuf);
    }
  }

  public async deserializeDecrypt<T>(
    cipherTextBuf: Buffer,
    raw: false,
  ): Promise<T>;
  public async deserializeDecrypt(
    cipherTextBuf: Buffer,
    raw: true,
  ): Promise<Buffer>;
  public async deserializeDecrypt<T>(
    cipherTextBuf: Buffer,
    raw: boolean,
  ): Promise<T | Buffer> {
    let plainTextBuf;
    if (this.workerManager != null) {
      plainTextBuf = await this.workerManager.call(async (w) => {
        const dbKey = utils.toArrayBuffer(this.dbKey);
        const cipherText = utils.toArrayBuffer(cipherTextBuf);
        const decrypted = await w.efsDecryptWithKey(
          Transfer(dbKey),
          // @ts-ignore: threads.js types are wrong
          Transfer(cipherText),
        );
        return decrypted != null ? utils.fromArrayBuffer(decrypted) : decrypted;
      });
    } else {
      plainTextBuf = utils.decryptWithKey(this.dbKey, cipherTextBuf);
    }
    if (plainTextBuf == null) {
      throw new dbErrors.ErrorDBDecrypt();
    }
    return raw ? plainTextBuf : dbUtils.deserialize<T>(plainTextBuf);
  }
}

export default DB;
