import { alloc, reader } from '../../shared.js'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const workerPath = path.join(__dirname, 'worker.mjs')

const numValues = 1e3

const rand = (n) => Math.floor(Math.random() * n)
const randInt = (a, b) => rand(b - a + 1) + a

const minSize = 12
const maxSize = 100
const minWrite = 4

setInterval(() => {}, 1e3)

for (;;) {
  const size = Math.ceil(randInt(minSize, maxSize) / 4) * 4 + 16
  const maxWrite = size - 32
  const slowReader = !!rand(2)
  console.log('TEST', { size, slowReader })

  const shared = alloc(size)
  const worker = new Worker(workerPath, { workerData: { shared, numValues, minWrite, maxWrite } })
  worker.on('error', console.error)

  const read = reader(shared)
  await new Promise((resolve) => {
    queueMicrotask(async () => {
      let expected = 0
      while (true) {
        read((data) => {
          const value = data.readInt32LE(0)
          if (value !== expected) {
            throw new Error(`wrong value actual=${value} expected=${expected}`)
          }
          expected++
        })
        if (expected === numValues) {
          resolve()
        }
        if (slowReader) {
          await setTimeout(1)
        }
      }
    })
  })
}
