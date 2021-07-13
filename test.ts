import pathNode from 'path';
import {
  md,
  random,
  pkcs5
} from 'node-forge';
import * as utils from './src/utils';

async function main () {

  // why is it turning it into a dirname?
  // OH because it's a directory?

  // it's asking for the directory
  // and adding the suffix

  const path = './abc////../a';


  // let dir = pathNode.dirname(path);

  // const dir_ = utils.addSuffix(dir);

  // console.log(dir_);

  // const file = pathNode.basename(path.toString());

  // console.log(file);

  console.log(utils.translatePath(path));

  // basepath / dir / .file.meta

  // dir itself is abc.data/.file.meta



}

main();
