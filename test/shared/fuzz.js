const { alloc, reader, writer } = require('../../shared.js')
const assert = require('node:assert')

function fuzz(seed) {
  function random() {
    const x = Math.sin(seed++)
    return x - Math.floor(x)
  }
  const rand = (n) => Math.floor(random() * n)
  const randInt = (a, b) => rand(b - a + 1) + a

  const size = randInt(16, 256) * 4
  const shared = alloc(size)
  const write = writer(shared)
  const read = reader(shared)

  let writeIdx = 0
  let readIdx = 0
  const values = []

  const cnt = Math.floor(Math.random() * 10000)
  for (let n = 0; n < cnt; n++) {
    if (random() > 0.5) {
      const writeSize = randInt(16, size - 64)
      write(writeSize, (dataPos, buffer) => {
        const value = writeIdx++
        values.push(value)
        buffer.fill(0, dataPos, dataPos + writeSize)
        buffer.writeInt32LE(value, dataPos)
        return dataPos + writeSize
      })
    } else {
      read((buffer, dataPos, dataLen) => {
        const value = buffer.readInt32LE(dataPos)
        const expected = values[readIdx++]
        assert.equal(value, expected, `readIdx: ${readIdx}, value: ${value}, expected: ${expected}`)
      })
    }
  }
}

let seed = 0
try {
  const startTime = Date.now()
  while (Date.now() - startTime < 30e3) {
    fuzz(seed++)
  }
} catch (err) {
  console.error(err)
}

console.log('seed', seed)
