import callbackify from 'util-callbackify';

/**
 * Generic callback
 */
type Callback<P extends Array<any> = [], R = any, E extends Error = Error> = {
  (e: E, ...params: Partial<P>): R;
  (e: null | undefined, ...params: P): R;
};

async function maybeCallback<T>(
  f: () => Promise<T>,
  callback?: Callback<[T]>
): Promise<T | void> {
  if (callback == null) {
    return await f();
  } else {
    callbackify(f)(callback);
    return;
  }
}

async function doSomething(): Promise<void>;
async function doSomething(callback: Callback): Promise<void>;
async function doSomething(callback?: Callback): Promise<void> {
  return maybeCallback(async () => {
    return await new Promise<void>((resolve) => {
      setTimeout(() => { resolve(); });
    });
  }, callback);
}

async function returnSomething(): Promise<number>;
async function returnSomething(callback: Callback<[number]>): Promise<void>;
async function returnSomething(callback?: Callback<[number]>): Promise<number | void> {
  return maybeCallback(async () => {
    return await new Promise<number>((resolve) => {
      setTimeout(() => { resolve(100); });
    });
  }, callback);
}

async function main () {
  // promise style
  await doSomething();
  console.log('done with promises');

  // callback style
  doSomething((e) => {
    if (e != null) {
      console.log('oh no', e);
      return;
    }
    console.log('done!');
  });

  // promise style
  console.log(await returnSomething());

  // callback style
  returnSomething((e, num) => {
    if (e != null) {
      console.log('oh no', e);
      return;
    }
    console.log('done!', num);
  });
}

main();
