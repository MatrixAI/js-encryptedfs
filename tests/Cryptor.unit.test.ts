import { EncryptedFSCrypto } from '../src/EncryptedFSCrypto';
import * as crypto from 'crypto';

describe('Crypto class', () => {
    describe('Syncronous tests', () => {
        let key: Buffer;
        let encryptedFSCrypto: EncryptedFSCrypto;

        beforeEach(() => {
            // Create the cryptor
            key = Buffer.from('very password');
            encryptedFSCrypto = new EncryptedFSCrypto(key, crypto);
        });
        test('Crypto - initialisation', () => {
            expect(encryptedFSCrypto).toBeInstanceOf(EncryptedFSCrypto);
        });
        test('Crypto - encrypt sync', () => {
            let encryptedFSCrypto2 = new EncryptedFSCrypto(key, crypto);
            let plaintext = Buffer.from('very important secret');

            let chunk1 = encryptedFSCrypto.encryptBlockSync(plaintext);
            let chunk2 = encryptedFSCrypto2.encryptBlockSync(plaintext);

            const decryptedText1 = encryptedFSCrypto.decryptChunkSync(chunk1).toString();
            const decryptedText2 = encryptedFSCrypto2.decryptChunkSync(chunk2).toString();
            expect(decryptedText1).toEqual(decryptedText2);
        });
        test('decrypt - sync', () => {
            let plainBuf = Buffer.from('very important secret');

            let cipherText = encryptedFSCrypto.encryptBlockSync(plainBuf);
            let deciphered = encryptedFSCrypto.decryptChunkSync(cipherText);

            expect(deciphered).toEqual(plainBuf);
        });
    });

    describe('Asyncronous tests', () => {
        let key: Buffer;
        let encryptedFSCrypto: EncryptedFSCrypto;

        beforeEach(() => {
            // Create the cryptor
            key = Buffer.from('very password');
            encryptedFSCrypto = new EncryptedFSCrypto(key, crypto);
        });
        test('encrypt - async', async (done) => {
            const encryptedFSCryptoSync = new EncryptedFSCrypto(key, crypto);

            const plainBuf = Buffer.from('very important secret');

            const cipherBufSync = encryptedFSCryptoSync.encryptBlockSync(plainBuf);
            const decryptedBufSync = encryptedFSCryptoSync.decryptChunkSync(cipherBufSync);

            const cipherBuf = await encryptedFSCrypto.encryptBlock(plainBuf);
            const decryptedBuf = await encryptedFSCrypto.decryptChunk(cipherBuf);

            expect(decryptedBufSync).toEqual(decryptedBuf);
            expect(decryptedBufSync).toEqual(plainBuf);
            done();
        });

        test('encryption and decryption are consistent async', async (done) => {
            let plainBuf = Buffer.from('very important secret');

            let cipherBuf = await encryptedFSCrypto.encryptBlock(plainBuf);
            const deciphered = await encryptedFSCrypto.decryptChunk(cipherBuf);

            expect(deciphered).toStrictEqual(plainBuf);
            expect(cipherBuf).not.toEqual(plainBuf);
            done();
        });

        test('encryption and decryption do not throw errors - async', async () => {
            let plainBuf = Buffer.from('very important secret');
            const cipherBuf = await encryptedFSCrypto.encryptBlock(plainBuf);

            expect(encryptedFSCrypto.encryptBlock(plainBuf)).resolves.not.toThrow();
            expect(encryptedFSCrypto.decryptChunk(cipherBuf)).resolves.not.toThrow();
        });
    });

    describe('Webworker tests', () => {
        let key: Buffer;
        let encryptedFSCrypto: EncryptedFSCrypto;

        beforeEach(() => {
            // Create the cryptor
            key = Buffer.from('very password');
            encryptedFSCrypto = new EncryptedFSCrypto(key, crypto, true);
        });

        test('can use webworkers - async', async (done) => {
            const plainBuf = Buffer.from('some plaintext');

            const cipherBuf = await encryptedFSCrypto.encryptBlock(plainBuf);

            const decryptedBuf = await encryptedFSCrypto.decryptChunk(cipherBuf);

            expect(decryptedBuf).toEqual(plainBuf);
            expect(decryptedBuf).not.toEqual(cipherBuf);
            done();
        });

        test('webworkers are faster than sync', async (done) => {
            const numTrials = 500;
            const randomBlocks: Buffer[] = [];
            for (let i = 0; i < numTrials; i++) {
                const randomBlock = crypto.randomBytes(4096);
                randomBlocks.push(randomBlock);
            }
            const t0 = performance.now();
            await Promise.all(
                randomBlocks.map((buffer) => {
                    return encryptedFSCrypto.encryptBlock(buffer);
                }),
            );
            const webworkersTime = performance.now() - t0;

            const t1 = performance.now();
            // Test sync
            randomBlocks.forEach((buffer) => {
                encryptedFSCrypto.encryptBlockSync(buffer);
            });
            const syncTime = performance.now() - t1;

            expect(syncTime).toBeGreaterThan(webworkersTime);
            done();
        }, 10000);
    });
});
