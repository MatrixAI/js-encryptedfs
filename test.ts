import {
  md,
  random,
  pkcs5
} from 'node-forge';

import * as utils from './src/utils';

async function main () {

  // now the salt has to be returned unless the user wants to provide the salt

  // the user password as a "phrase"
  // and from here we stretch it into a key
  // this is not a the bip39 standard
  // the salt must be returned to the end user
  // if they intend to make use of it

  // const salt = (await utils.getRandomBytes(utils.cryptoConstants.SALT_LEN)).toString('binary');
  // const output = pkcs5.pbkdf2('abc', salt, 2048, 100, md.sha512.create());
  // const b = Buffer.from(output, 'binary');
  // console.log(b);

  const b = await utils.generateKey('abc');
  console.log(b.length);

  // const b2 = utils.generateKeySync('abc sdfijs ofijs oifjs oidfj wefj soidfjso fjsdofi sdf sdf sdfsd fsuf osidufj oisdf sodif usd');
  // console.log(b2);



}

main();
