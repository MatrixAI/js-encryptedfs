import fs from 'fs/promises';

async function main () {

  await fs.writeFile('./tmp/fdtest', 'abcdef');
  const fd = await fs.open('./tmp/fdtest', 'r+');
  await fd.truncate(4);
  await fd.close();
  console.log(await fs.readFile('./tmp/fdtest', { encoding: 'utf-8' }));

}

main();
