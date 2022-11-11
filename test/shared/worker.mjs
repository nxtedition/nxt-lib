import { writer } from '../../shared.js'
import { parentPort, workerData } from 'node:worker_threads'

const { shared, numValues, minWrite, maxWrite } = workerData

const rand = (n) => Math.floor(Math.random() * n)
const randInt = (a, b) => rand(b - a + 1) + a

const { write } = writer(shared)

parentPort.ref()

for (let i = 0; i < numValues; i++) {
  const writeSize = randInt(minWrite, maxWrite)
  write(writeSize, (dataPos, buffer) => {
    buffer.fill(0, dataPos, writeSize)
    buffer.writeInt32LE(i, dataPos)
    return dataPos + writeSize
  })
}

parentPort.postMessage('done')
parentPort.unref()
