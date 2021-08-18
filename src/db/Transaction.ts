import type DB from './DB';
import type { DBDomain, DBOps, DBTransaction } from './types';

import * as dbUtils from './utils';
import * as dbErrors from './errors';

/**
 * Minimal transaction system
 * Abstracts on top of the leveldb batch system
 * A makeshift "read-committed" isolation level, reads can be dirty (but prevented due to advisory locks)
 * Will only read data that have been committed, won't see dirty reads.
 *
 * Leveldb is not an MVCC database.
 * This when combined with advisory locking provides a "read-commited" isolation-level context.
 * This means dirty reads are not possible. But non-repeatable reads and phantom reads are all possible.
 * If we had access to leveldb snapshots, we could level up to "repeatable-read" isolation level and prevent
 * non-repeatable reads for both iteration/streaming and get. However we would still have lost-updates.
 */
class Transaction implements DBTransaction {

  protected db: DB;
  protected _ops: DBOps = [];
  protected _snap: Map<string, any> = new Map;
  protected _callbacksSuccess: Array<() => any> = [];
  protected _callbacksFailure: Array<() => any> = [];
  protected _committed: boolean = false;
  protected _rollbacked: boolean = false;

  public constructor (db: DB) {
    this.db = db;
  }

  get ops(): Readonly<DBOps> {
    return this._ops;
  }

  get snap(): ReadonlyMap<string, any> {
    return this._snap;
  }

  get callbacksSuccess(): Readonly<Array<() => any>> {
    return this._callbacksSuccess;
  }

  get callbacksFailure(): Readonly<Array<() => any>> {
    return this._callbacksFailure;
  }

  get committed(): boolean {
    return this._committed;
  }

  get rollbacked(): boolean {
    return this._rollbacked;
  }

  public async get<T>(
    domain: DBDomain,
    key: string | Buffer,
    raw?: false,
  ): Promise<T | undefined>;
  public async get<T>(
    domain: DBDomain,
    key: string | Buffer,
    raw: true,
  ): Promise<Buffer | undefined>;
  public async get<T>(
    domain: DBDomain,
    key: string | Buffer,
    raw: boolean = false,
  ): Promise<T | undefined> {
    const path = dbUtils.domainPath(domain, key).toString('binary');
    let value: T | undefined;
    if (this._snap.has(path)) {
      value = this._snap.get(path);
    } else {
      value = await this.db.get<T>(domain, key, raw as any);
      // don't need this atm
      // there is no repeatable-read "snapshot"
      // this._snap.set(path, value);
      // dirty reads
    }
    return value;
  }

  public async put(
    domain: DBDomain,
    key: string | Buffer,
    value: any,
    raw?: false
  ): Promise<void>;
  public async put(
    domain: DBDomain,
    key: string | Buffer,
    value: Buffer,
    raw: true
  ): Promise<void>;
  public async put(
    domain: DBDomain,
    key: string | Buffer,
    value: any,
    raw: boolean = false,
  ): Promise<void> {
    const path = dbUtils.domainPath(domain, key).toString('binary');
    this._snap.set(path, value);
    this._ops.push({
      type: 'put',
      domain,
      key,
      value,
      raw
    });
  }

  public async del(
    domain: DBDomain,
    key: string | Buffer,
  ): Promise<void> {
    const path = dbUtils.domainPath(domain, key).toString('binary');
    this._snap.set(path, undefined);
    this._ops.push({
      type: 'del',
      domain,
      key,
    });
  }

  public queueSuccess(f: () => any): void {
    this._callbacksSuccess.push(f);
  }

  public queueFailure(f: () => any): void {
    this._callbacksFailure.push(f);
  }

  public async commit(): Promise<void> {
    if (this._rollbacked) {
      throw new dbErrors.ErrorDBRollbacked;
    }
    if (this._committed) {
      return;
    }
    this._committed = true;
    try {
      await this.db.batch(this._ops);
    } catch (e) {
      this._committed = false;
      throw e;
    }
  }

  public async rollback(): Promise<void> {
    if (this._committed) {
      throw new dbErrors.ErrorDBCommitted;
    }
    if (this._rollbacked) {
      return;
    }
    this._rollbacked = true;
    for (const f of this._callbacksFailure) {
      await f();
    }
  }

  public async finalize (): Promise<void> {
    if (this._rollbacked) {
      throw new dbErrors.ErrorDBRollbacked;
    }
    if (!this._committed) {
      throw new dbErrors.ErrorDBNotCommited;
    }
    for (const f of this._callbacksSuccess) {
      await f();
    }
  }

}

export default Transaction;
