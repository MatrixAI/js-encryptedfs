import Cryptor from './Cryptor';
import * as jest from 'ts-jest';
import * as crypto from 'crypto';


describe('Cryptor class', () => {
	// Define initialization vector for all tests
	const iv = crypto.randomBytes(16);

	describe('Syncronous tests', () => {
		test('Cryptor - initialisation', () => {
			let cryptor = new Cryptor('secret password');
			expect(cryptor).toBeInstanceOf(Cryptor);
		});
		test('Cryptor - encrypt sync', t => {
			let cryptor = new Cryptor('secret password', iv);
			let cryptor2 = new Cryptor('secret password', iv);
			let plaintext = 'very important secret';

			let cipherText = cryptor.encryptSync(plaintext);
			let cipherText2 = cryptor2.encryptSync(plaintext);

			// TODO: we have the iv, passworkd/key, and block mode
			// the ciphertext can be verfied independenly of this
			// we should assert it is equal to the cipher from a diff source
			expect(cipherText).toStrictEqual(plaintext);
			// same cipher when plaintext encrypted with constance iv
			expect(cipherText).toStrictEqual(cipherText2);
		});
		test('Cryptor - decrypt sync', t => {
			let crytor = new Cryptor('secret password', iv);
			let plaintext = 'very important secret';

			let cipherText = crytor.encryptSync(plaintext);
			let deciphered = crytor.decryptSync(cipherText).toString();

			expect(deciphered).toBe(plaintext);
		});
	})

	describe('Asyncronous tests', () => {
		test('Cryptor - encrypt async', () => {
			let cryptorSync = new Cryptor('secret password', iv);
			let cryptor = new Cryptor('secret password', iv);

			let plaintext = 'very important secret';

			let cipherTextSync = cryptorSync.encryptSync(plaintext);

			expect.assertions(2);
			let cipherText = cryptor.encrypt(plaintext, (err, cipherText) => {
				if (err) {
					fail(err)
				} else {
					expect(cipherText).toEqual(plaintext);
					// cipher same as when using sync fn
					expect(cipherText).toStrictEqual(cipherTextSync);
					console.log(cipherText);
				};
			});
		});

		test('Cryptor - decrypt async', () => {
			let cryptor = new Cryptor('secret password', iv);
			let plaintext = 'very important secret';

			let cipherText = cryptor.encryptSync(plaintext);

			expect.assertions(1);
			cryptor.decrypt(cipherText, (err, deciphered) => {
				if (err) {
					fail(err)
				} else {
					expect(deciphered.toString()).toStrictEqual(plaintext);
				}
			});
		});
	})
});
