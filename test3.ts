import callbackify from "util-callbackify";

type Callback<P extends Array<any> = [], R = any, E extends Error = Error> = {
  (e: E, ...params: Partial<P>): R;
  (e: null | undefined, ...params: P): R;
};

async function doX(): Promise<number>;
async function doX(callback: Callback<[number]>): Promise<void>;
async function doX(callback?: Callback<[number]>): Promise<number | void> {
  if (callback == null) {
    return await new Promise<number>((resolve, reject) => {
      setTimeout(() => {
        resolve(1);
      });
    });
  } else {
    const f = callbackify<number>(doX);
    f(callback);
  }
}

async function main () {
  const num = await doX();
  console.log(num);
  doX((e, num) => {
    console.log('error', e);
    console.log('inside callback');
    console.log(num);
  });
}

main();
