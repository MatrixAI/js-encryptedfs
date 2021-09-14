import type { AbstractLevelDOWN, AbstractIterator } from 'abstract-leveldown';
import type { LevelUp } from 'levelup';

type DBDomain = Readonly<Array<string>>;

type DBLevel = LevelUp<
  AbstractLevelDOWN<string | Buffer, Buffer>,
  AbstractIterator<Buffer, Buffer>
>;

type DBOp_ =
  | {
      domain: DBDomain;
      key: string | Buffer;
      value: any;
      raw?: false;
    }
  | {
      domain: DBDomain;
      key: string | Buffer;
      value: Buffer;
      raw: true;
    };

type DBOp =
  | ({
      type: 'put';
    } & DBOp_)
  | ({
      type: 'del';
    } & Omit<DBOp_, 'value' | 'raw'>);

type DBOps = Array<DBOp>;

interface DBTransaction {
  ops: Readonly<DBOps>;
  snap: ReadonlyMap<string, any>;
  callbacksSuccess: Readonly<Array<() => any>>;
  callbacksFailure: Readonly<Array<() => any>>;
  committed: boolean;

  get<T>(
    domain: DBDomain,
    key: string | Buffer,
    raw?: false,
  ): Promise<T | undefined>;
  get<T>(
    domain: DBDomain,
    key: string | Buffer,
    raw: true,
  ): Promise<Buffer | undefined>;

  put(
    domain: DBDomain,
    key: string | Buffer,
    value: any,
    raw?: false,
  ): Promise<void>;
  put(
    domain: DBDomain,
    key: string | Buffer,
    value: Buffer,
    raw: true,
  ): Promise<void>;

  del(domain: DBDomain, key: string | Buffer): Promise<void>;

  queueSuccess(f: () => any): void;

  queueFailure(f: () => any): void;
}

export type { DBDomain, DBLevel, DBOp, DBOps, DBTransaction };
