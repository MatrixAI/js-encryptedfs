import EncryptedFS from '../../src/async/EncryptedFS';
import * as fs from 'fs';
import * as jest from 'jest';


describe('EncryptedFS testing', () => {
	let efs = new EncryptedFS('super secret password');

	beforeEach(async () => {
		await efs._cryptor.init('secret password');
	});

	test('Test initialization', async () => {
		let efs = new EncryptedFS('super secret passworrd');
		await efs._cryptor.init('secret password');
	});
	
	
	test('constructor type', t => {
		expect(efs).toBeInstanceOf(EncryptedFS);
	});
	
	test('readdir', t => {
		let expected = fs.readdirSync('./');
		let actual = efs.readdirSync('./')
		expect(actual).toEqual(expected);
	});
	
});
