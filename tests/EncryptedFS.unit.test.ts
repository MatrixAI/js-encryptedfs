import EncryptedFS from '../src/EncryptedFS'
import * as jest from 'ts-jest'
import * as crypto from 'crypto'
import fs from 'fs'
import { resolve } from 'dns'

describe('EncryptedFS class', () => {
	// Define temp directory
	const tempDir = fs.mkdtempSync('tmp')

//   test('the data is peanut butter', done => {
//     function callback(data) {
//       try {
//         expect(data).toBe('peanut butter')
//         done()
//       } catch (error) {
//         done(error)
//       }
//     }

//     fetchData(callback)
//   })

  test('initialisation', t => {
  	function callback(data) {

  	}
  	// let efs = new EFS({password:'very password'})
  	//
  	// t.true(efs instanceof EFS)
  })


  test('open - sync', t => {
  	let efs = new EncryptedFS({password:'very password'})

  	let fd = efs.openSync(`${tempDir}/efs_test.txt`)
  	console.log(typeof fd)

  	// TODO: are there better tests than this?
  	expect((fd).constructor).toBeInstanceOf(Number)
  })


  test('open - async', () => {
	let efs = new EncryptedFS({password:'very password'})
	
	expect.assertions(2)
	let fd = efs.open(`${tempDir}/efs_test.txt`, 'r', (err, fd) => {
		expect(err).toStrictEqual(null)
		expect((fd).constructor).toBeInstanceOf(Number)
	})
  })

  // TODO: find a way to unit test this method
  test('write - sync', () => {
	let efs = new EncryptedFS({password:'very password'})

	let fd = efs.openSync(`${tempDir}/test.txt`)
	console.log(fd)
	const writeBuf = new Buffer("Super confidential information")
	efs.writeSync(fd, writeBuf)
  })

  // TODO: find a way to unit test this method
  test('read - sync', t => {
  	let efs = new EncryptedFS({password:'very password'})

  	let fd = efs.openSync(`${tempDir}/test.txt`)

  	const dummyBuffer = Buffer.alloc(10)

  	const pt = efs.readSync(fd, dummyBuffer, 0, 1, 0)
  })


  test('write then read - single block', t => {
  	let efs = new EncryptedFS({password:'very password'})

  	let fd = efs.openSync(`${tempDir}/test.txt`)

  	const writeBuffer = new Buffer("Super confidential information")

  	efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0)

  	let readBuffer = Buffer.alloc(writeBuffer.length)

  	efs.readSync(fd, readBuffer, 0, writeBuffer.length, 0)

  	expect(writeBuffer).toStrictEqual(readBuffer)
  })

  test('write then read - multiple blocks', t => {
  	let efs = new EncryptedFS({password:'very password'})

  	let fd = efs.openSync(`${tempDir}/test.txt`)

  	const blockSize = 4096

  	const writeBuffer = crypto.randomBytes(blockSize * 3)

  	efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0)

  	let readBuffer = Buffer.alloc(writeBuffer.length)

  	efs.readSync(fd, readBuffer, 0, writeBuffer.length, 0)

  	expect(writeBuffer).toStrictEqual(readBuffer)
  })



  // TODO: this should really be split out into tests only concerning writes and tests only concerning reads
  /* the start and end blocks are handled differently to the middle blocks
   * hence they all need their own tests to verify functionality */
  test('write non-zero position - middle of start block', t => {
  	let efs = new EncryptedFS({password:'very password'})

  	const blockSize = 4096


  	// write a three block file
  	const writePos = 2000
  	const writeBuffer = crypto.randomBytes(blockSize * 3)
  	const fd = efs.openSync(`${tempDir}/test_middle.txt`)
  	efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0)

  	// write data in the middle
  	const middleData = new Buffer('Malcom in the')
  	efs.writeSync(fd, middleData, 0, middleData.length, writePos)

  	// re-read the blocks
  	let readBuffer = Buffer.alloc(blockSize * 3)
  	efs.readSync(fd, readBuffer, 0, readBuffer.length, 0)

  	middleData.copy(writeBuffer, writePos)
  	const expected = writeBuffer


  	expect(readBuffer).toEqual(writeBuffer)
  	//t.deepEqual(expected.slice(0, blockSize), readBuffer.slice(0, blockSize))
  })

  test('write non-zero position - middle of middle block', t => {
  	let efs = new EncryptedFS({password:'very password'})

  	const blockSize = 4096


  	// write a three block file
  	const writePos = blockSize + 2000
  	const writeBuffer = crypto.randomBytes(blockSize * 3)
  	const fd = efs.openSync(`${tempDir}/test_middle.txt`)
  	efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0)

  	// write data in the middle
  	const middleData = new Buffer('Malcom in the')
  	efs.writeSync(fd, middleData, 0, middleData.length, writePos)

  	// re-read the blocks
  	let readBuffer = Buffer.alloc(blockSize * 3)
  	efs.readSync(fd, readBuffer, 0, readBuffer.length, 0)

  	middleData.copy(writeBuffer, writePos)
  	const expected = writeBuffer


  	expect(readBuffer).toEqual(writeBuffer)
  	//t.deepEqual(expected.slice(0, blockSize), readBuffer.slice(0, blockSize))
  })

  test('write non-zero position - middle of end block', t => {
  	let efs = new EncryptedFS({password:'very password'})

  	const blockSize = 4096


  	// write a three block file
  	const writePos = 2 * blockSize + 2000
  	const writeBuffer = crypto.randomBytes(blockSize * 3)
  	const fd = efs.openSync(`${tempDir}/test_middle.txt`)
  	efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0)

  	// write data in the middle
  	const middleData = new Buffer('Malcom in the')
  	efs.writeSync(fd, middleData, 0, middleData.length, writePos)

  	// re-read the blocks
  	let readBuffer = Buffer.alloc(blockSize * 3)
  	efs.readSync(fd, readBuffer, 0, readBuffer.length, 0)

  	middleData.copy(writeBuffer, writePos)
  	const expected = writeBuffer


  	expect(readBuffer).toEqual(writeBuffer)
  	//t.deepEqual(expected.slice(0, blockSize), readBuffer.slice(0, blockSize))
  })

  test('write segment spanning across two block', t => {
  	let efs = new EncryptedFS({password:'very password'})

  	const blockSize = 4096

  	// write a three block file
  	const writePos = 4090
  	const writeBuffer = crypto.randomBytes(blockSize * 3)
  	const fd = efs.openSync(`${tempDir}/test_middle.txt`)
  	efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0)

  	// write data in the middle
  	const middleData = new Buffer('Malcom in the')
  	efs.writeSync(fd, middleData, 0, middleData.length, writePos)

  	// re-read the blocks
  	let readBuffer = Buffer.alloc(blockSize * 3)
  	efs.readSync(fd, readBuffer, 0, readBuffer.length, 0)

  	middleData.copy(writeBuffer, writePos)
  	const expected = writeBuffer

  	expect(readBuffer.toString()).toEqual(expected.toString())
  })


  	// TODO: find a way to unit test this method
  	test('performance test without web workers', () => {
		const t0 = performance.now()

		let efs = new EncryptedFS({password:'very password', useWebWorkers:false})
		const blockSize = 4096
		for (let trial = 0; trial < 10000; trial++) {

			const filename = `test/nww-test${trial}.txt`
			
			const randomPass = crypto.randomBytes(blockSize*3).toString('hex')
			const writeBuffer = new Buffer(randomPass)
			let fd = efs.openSync(filename)
			efs.writeSync(fd, writeBuffer, 0, writeBuffer.length, 0)
	
			// Read from file
			fd = efs.openSync(filename, 'r')
			const readBuffer = Buffer.alloc(writeBuffer.length)
			efs.readSync(fd, readBuffer, 0, writeBuffer.length, 0)
	
			expect(readBuffer.toString()).toEqual(writeBuffer.toString())
			expect(readBuffer.toString()).toEqual(randomPass)
		}

		const t1 = performance.now()
		
		console.log("Without webworkers, 1000 runs took " + (t1 - t0)/1000. + " seconds.")
	})
	// TODO: find a way to unit test this method
	test('performance test with web workers', async (done) => {
		const t0 = performance.now()

		let efs = new EncryptedFS({password:'very password', useWebWorkers:true})
		const blockSize = 4096

		let trialCount = 0
		
		for (let trial = 0; trial < 10; trial++) {
			const x = async () => {
				const filename = `test/ww-test${trial}.txt`
				
				const randomPass = crypto.randomBytes(blockSize*3).toString('hex')
				const writeBuffer = new Buffer(randomPass)
				const fdwrite = efs.openSync(filename)
				await efs.write(fdwrite, writeBuffer, 0, writeBuffer.length, 0)

				// Read from file
				const fdread = efs.openSync(filename, 'r')
				const readBuffer = Buffer.alloc(writeBuffer.length)
				await efs.read(fdread, readBuffer, 0, writeBuffer.length, 0, () => {})

				// expect(readBuffer.toString()).toEqual(writeBuffer.toString())
				// expect(readBuffer.toString()).toEqual(randomPass)
				console.log(`Im encrypting document ${filename}`);
				
				trialCount++
			}
			x()
		}

		for (let trial = 0; trial < 10; trial++) {
			console.log('Im updating the UI');
			await new Promise(r => setTimeout(r, 10))
		}

		const t1 = performance.now()

		
		console.log("With webworkers, 1000 runs took " + (t1 - t0)/1000. + " seconds.")
		done()
  })
})
