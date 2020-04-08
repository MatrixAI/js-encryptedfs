import Cryptor from '../../src/async/Cryptor';
import * as jest from 'ts-jest';
import * as crypto from 'crypto';

describe('Test async Cryptor class', () => {

    // const iv = crypto.randomBytes(16);
    // test('temp', () => {
    //     console.log('delete me')
    // })
	// // TODO: better way to share data b/w test?
	// var ciphertext;
	// // test init behavior
	// test('Cryptor - initialisation', t => {
	// 	let cry = new Cryptor('secret password');
	// 	return ( result => {
	// 		expect(cry).toBeInstanceOf(Cryptor);
	// 		expect(cry.isInitialised());
	// 	});
	// });
	
	// test('Cryptor - not initialisation', t => {
	// 	let cry = new Cryptor('some password');
	
	// 	expect(cry).toBeInstanceOf(Cryptor);
	// 	expect(cry.isInitialised()).not;
	// });
	
	
	// // TODO: using serial to share data to decrypts seems like a bad idea.
	// test('Cryptor - encrypt', async t => {
	// 	let cry = new Cryptor('some password');
	// 	let plaintext = 'very important secret';
	
	// 	await cry.init('secret password');
	
	// 	let ct = await cry.encrypt(plaintext, iv);
	
	// 	expect(ct).not.toEqual(plaintext);
	// 	expect(ct).toBeInstanceOf(Buffer);
	
	// 	// TODO: set global shared var
	// 	ciphertext = ct;
	// });
	
	
	// test('Cryptor - decrypt', async t => {
	// 	const expected = new Buffer('very important secret');
	// 	let cry = new Cryptor('some password');
	// 	await cry.init('secret password');
	
	// 	let plaintext = await cry.decrypt(ciphertext, new Promise(() => {
	// 		return iv;
	// 	}));
	// 	// TODO: literal should be  global var?
	// 	expect(expected).toStrictEqual(plaintext);
	// });
	
	
	// // TODO: use deterministic/concrete control values for testing cipher results
	
	
	// // test decrypt
});
