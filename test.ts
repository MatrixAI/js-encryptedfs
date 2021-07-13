import lexi from 'lexicographic-integer';
import fs from 'fs';
import pathNode from 'path';
import EncryptedFS from './src/EncryptedFS';
import * as utils from './src/utils';

// import { DB } from './src/db';
// import { utils as dbUtils } from './src/db';

async function f (): Promise<void> {
  throw (new Error('oh no'));
}



// type O = {
//   name: string;
//   age: number;
//   location: string;
// };

// type X = Getters<O>;


// const [key,] = utils.generateKeyFromPassSync('abc', 'abc');

async function main () {

  try {
    f();
  } catch (e) {
    console.log('error', e.message);
  }


  // const db = new DB({
  //   dbKey: key,
  //   dbPath: './tmp/db',
  // });

  // await db.start();





  // here we go!

  // db.level('root', async (rootDb) => {
  //   db.put(['root'], 'str', 'abc', async () => {
  //     db.get<string>(['root'], 'str', async (e, data) => {
  //       console.log(data);
  //       await db.stop();
  //     });
  //   });
  // });

  // const rootDb = await db.level('root');

  // so we can have an array of levels
  // or a buffer key at the end
  // and let's see if that works


  // await db.put([], 'buf', Buffer.from('abc'), true);
  // console.log(
  //   await db.get<Buffer>([], 'buf', true)
  // );

  // await db.db.clear();


  // const k = Buffer.from(lexi.pack(1234));
  // await db.put([], k, 'abc');

  // const k2 = Buffer.from(lexi.pack(100));
  // await db.put([], k2, 'def');

  // const k3 = 'randomstring';
  // await db.put([], k3, 'ooo');

  // test 1. is it still in-order
  // test 2. can i still have sublevels that use string keys?
  // test 3. can use string keys



  // oh wait we are doing it
  // @ts-ignore
  // for await (const o of db.db.createReadStream()) {
  //   // we don't know what this is

  //   // @ts-ignore
  //   const k = (o as any).key as string;
  //   const v = (o as any).value as Buffer;

  //   // i reckon it utf-8 encodes the keys here
  //   // that's the problem
  //   // console.log(k);
  //   console.log(typeof k);
  //   console.log(k.length);

  //   console.log([...Buffer.from(k, 'utf-8')]);

  //   // console.log([...k]);
  //   // console.log(lexi.unpack([...k]));
  //   // oh they are buffers
  //   // well cause they are buffers

  //   // storage wise, it's the same
  //   // if stored as a string
  //   // it's still returned as a string
  //   // a "Binary string" that is

  //   // so here we go
  //   const v_ = await db.deserializeDecrypt(v, false);
  //   console.log(v_);

  // }

  // const v = await db.get<string>([], k);
  // console.log(v);

  // const v2 = await db.get<string>([], k2);
  // console.log(v2);


  // const v3 = await db.get<string>([], 'randomstring');
  // console.log(v3);



  // await db.stop();

  // oh
  // interesting
  // when stringify it is actually
  // the data
  // oh it becomes an array of numbers
  // how interesting
  // so you "do" get the buffer
  // but if you do
  // you have to convert it back
  // lol


}

main();


// const plainText = 'a'.repeat(4096);
// const plainBuffer = Buffer.from(plainText, 'utf-8');
// const plainText2 = 'b'.repeat(4096);
// const plainBuffer2 = Buffer.from(plainText2, 'utf-8');
// const cipherBuffer1 = utils.encryptWithKey(key, plainBuffer);
// const cipherBuffer2 = utils.encryptWithKey(key, plainBuffer);

// console.log(cipherBuffer1);
// console.log(cipherBuffer2);

// fs.writeFileSync('./tmp/dir/a.data', Buffer.concat([cipherBuffer1, cipherBuffer2]));

// const cipherBuffer3 = fs.readFileSync('./tmp/dir/a.data');

// console.log(cipherBuffer3);
// console.log(cipherBuffer3.byteLength);


// const cipherBuffer1_ = cipherBuffer3.slice(0, 16 + 16 + 4096);

// const plainBuffer1_ = utils.decryptWithKey(key, cipherBuffer1_);

// console.log(plainBuffer1_);

// const efs = new EncryptedFS(
//   key,
//   './tmp/dir',
//   fs,
// );

// // this is starting at the root /a
// const f = efs.openSync('/a');

// // reading 1024 bytes here
// const b = Buffer.alloc(1000);

// const h = efs.readSync(f, b);

// console.log('how many', h);

// console.log(b);
