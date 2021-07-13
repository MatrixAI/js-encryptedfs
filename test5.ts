import lexi from 'lexicographic-integer';
import sublevelprefixer from 'sublevel-prefixer';
import { utils } from './src/db';

// test with a domain path being buffer or string
// cause right now sometimes we need to use a db domain that may be buffer?
// if we lexi pack the inode id
// and the counter is the "highest" number

const prefixer = sublevelprefixer('!');

// so 100 is the INodeIndex
// and we are packing it as a key
const k = Buffer.from(lexi.pack(100));

const p = utils.domainPath(['a', 'b'], k);

console.log(p);

// so the above works fine
// @ts-ignore
const p2 = utils.domainPath(['a', Buffer.from('b', 'utf-8')], k);

// so it does work
// if domain path has buffers too
// so it is fine!
console.log(p2);
