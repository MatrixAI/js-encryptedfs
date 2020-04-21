import * as fs from 'fs';
import * as crypto from 'crypto';
import * as process from 'process';
import { spawn, Worker, ModuleThread } from 'threads'
import { CryptorWorker } from './CryptorWorker';

// TODO: function docs

interface CryptorParameters {
	pass: string
	initVector?: Buffer
	algorithm?: string
	useWebWorkers?: boolean
}

export default class Cryptor {
	private _algorithm: string;
	private readonly _initVector: Buffer;
	private _key: Buffer;
	private _cipher: crypto.Cipher;
	private _decipher: crypto.Decipher;
	private _useWebWorkers: boolean;
	private _cryptorWorker?: ModuleThread<CryptorWorker>;
	constructor({
		pass,
		initVector = crypto.randomBytes(16),
		algorithm = 'aes-256-gcm',
		useWebWorkers = false }: CryptorParameters) {
		this._algorithm = algorithm;
		this._initVector = initVector;
		// TODO: generate salt ?
		this._key = this._pbkdfSync(pass);
		this._cipher = crypto.createCipheriv(algorithm, this._key, this._initVector);
		this._decipher = crypto.createDecipheriv(algorithm, this._key, this._initVector);
		// Async via Process or Web workers
		this._useWebWorkers = useWebWorkers;
		if (this._useWebWorkers) {
			spawn<CryptorWorker>(new Worker("./CryptorWorker")).then((worker) => {
				this._cryptorWorker = worker
				this._cryptorWorker.init(this._algorithm, this._key, this._initVector)
			})
		}
	}


	encryptSync(plainBuf: crypto.BinaryLike, initVector?: Buffer): Buffer {
		if (initVector && (initVector !== this._initVector)) {
			this._resetCipherSync(initVector!);
		}
		return this._cipher.update(plainBuf);
	}

	// TODO: needs iv param
	async encrypt(plainBuf: crypto.BinaryLike, initVector?: Buffer) {
		if (initVector && (initVector !== this._initVector)) {
			this._resetCipher(initVector!);
		}
		if (this._useWebWorkers && this._cryptorWorker) {
			return this._cryptorWorker.updateCipher(this._algorithm, this._key, this._initVector, plainBuf);
		} else {
			return this._cipher.update(plainBuf)
		}
	}

	decryptSync(cipherBuf: NodeJS.ArrayBufferView, initVector?: Buffer) {
		if (initVector && (initVector !== this._initVector)) {
			this._resetDecipherSync(initVector!);
		}

		return this._decipher.update(cipherBuf);
	}

	async decrypt(cipherBuf: NodeJS.ArrayBufferView, initVector?: Buffer): Promise<Buffer> {
		if (initVector && (initVector !== this._initVector)) {
			this._resetDecipher(initVector!);
		}

		if (this._useWebWorkers && this._cryptorWorker) {
			return await this._cryptorWorker.updateDecipher(this._algorithm, this._key, this._initVector, cipherBuf);
		} else {
			return this._decipher.update(cipherBuf)
		}
	}

	decryptCommitSync(): Buffer {
		return this._decipher.final()
	}

	async decryptCommit(): Promise<Buffer> {
		return this._decipher.final()
	}

	// TODO: should all of these be public methods?
	// ========= HELPER FUNCTIONS =============
	_resetCipherSync(initVector: crypto.BinaryLike) {
		this._cipher = crypto.createCipheriv(this._algorithm, this._key, initVector);

		return;
	}

	async _resetCipher(initVector: crypto.BinaryLike) {
		if (this._useWebWorkers && this._cryptorWorker) {
			return await this._cryptorWorker._resetCipher(this._algorithm, this._key, initVector);
		} else {
			this._cipher = crypto.createCipheriv(this._algorithm, this._key, this._initVector)
		}
		return;
	}

	_resetDecipherSync(initVector: crypto.BinaryLike) {
		this._decipher = crypto.createDecipheriv(this._algorithm, this._key, initVector);

		return;
	}

	async _resetDecipher(initVector: crypto.BinaryLike) {
		if (this._useWebWorkers && this._cryptorWorker) {
			return await this._cryptorWorker._resetCipher(this._algorithm, this._key, initVector);
		} else {
			this._decipher = crypto.createDecipheriv(this._algorithm, this._key, this._initVector)
		}
		return;
	}

	genRandomInitVectorSync() {
		return crypto.randomBytes(16);
	}

	async genRandomInitVector(): Promise<Buffer> {
		return crypto.randomBytes(16);
	}

	_pbkdfSync(pass: crypto.BinaryLike, salt = '', algo = 'sha256', keyLen = 32, numIterations = 10000): Buffer {
		return crypto.pbkdf2Sync(pass, salt, numIterations, keyLen, algo);
	}

	async _pbkdf(pass: crypto.BinaryLike, salt = '', algo = 'sha256', keyLen = 32, numIterations = 10000, callback: (err: Error | null, key: Buffer) => void) {
		crypto.pbkdf2(pass, salt, numIterations, keyLen, algo, (err, key) => {
			callback(err, key);
		});
	}

	// TODO: should there be an input param for variable length iv?
}