const { test } = require('tap')
const { alloc, reader, writer } = require('../../shared.js')
const { setTimeout } = require('node:timers/promises')

const RANGE = 1 - Number.EPSILON
const makeRandom = (seed) => {
  const random = () => ((Math.sin(seed++) + 1) / 2) * RANGE
  const rand = (n) => Math.floor(random() * n)
  const randInt = (a, b) => rand(b - a + 1) + a
  return { random, rand, randInt }
}

const fuzz = (seed) =>
  new Promise((resolve) => {
    test(`seed ${seed}`, async (t) => {
      const { random, rand, randInt } = makeRandom(seed)

      const size = randInt(64, 256) * 4
      const shared = alloc(size)
      const write = writer(shared)
      const read = reader(shared)

      let writeIdx = 0
      let readIdx = 0
      const values = []

      let value
      let expected
      let writeSize
      try {
        const cnt = randInt(1000, 10000)
        for (let n = 0; n < cnt; n++) {
          if (random() > 0.5) {
            writeSize = randInt(16, Math.floor(size / 4))
            write(writeSize, (dataPos, buffer) => {
              const value = rand(0x7fffffff)
              values[writeIdx++] = value
              buffer.fill(0, dataPos, dataPos + writeSize)
              buffer.writeInt32LE(value, dataPos)
              return dataPos + writeSize
            })
          } else {
            read((buffer, dataPos, dataLen) => {
              value = buffer.readInt32LE(dataPos)
              expected = values[readIdx++]
              t.equal(value, expected)
            })
          }
        }

        while (readIdx !== writeIdx) {
          read((buffer, dataPos, dataLen) => {
            value = buffer.readInt32LE(dataPos)
            expected = values[readIdx++]
            t.equal(value, expected)
          })

          await setTimeout(200)
        }
      } catch (err) {
        console.error(
          err,
          JSON.stringify(
            {
              value,
              expected,
              writeSize,
              writeIdx,
              readIdx,
            },
            undefined,
            2
          )
        )
        t.fail()
      }
      t.end()
      resolve()
    })
  })

const { rand } = makeRandom(0)
const makeSeed = () => rand(0xffff)

;(async () => {
  for (let i = 0; i < 100; i++) {
    await fuzz(makeSeed())
  }
})()
