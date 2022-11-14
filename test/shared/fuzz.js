const { alloc, reader, writer } = require('../../shared.js')
const assert = require('node:assert')

function fuzz(seed) {
  function random() {
    return Math.abs(Math.sin(seed++))
  }
  const rand = (n) => Math.floor(random() * n)
  const randInt = (a, b) => rand(b - a + 1) + a

  const size = randInt(64, 256) * 4
  const shared = alloc(size)
  const write = writer(shared)
  const read = reader(shared)

  let writeIdx = 0
  let readIdx = 0
  const values = []

  const cnt = randInt(1000, 10000)
  for (let n = 0; n < cnt; n++) {
    let value
    let expected
    let writeSize
    try {
      if (random() > 0.5) {
        writeSize = randInt(16, size - 64)
        write(writeSize, (dataPos, buffer) => {
          const value = writeIdx++
          values.push(value)
          buffer.fill(0, dataPos, dataPos + writeSize)
          buffer.writeInt32LE(value, dataPos)
          return dataPos + writeSize
        })
      } else {
        read((buffer, dataPos, dataLen) => {
          value = buffer.readInt32LE(dataPos)
          expected = values[readIdx++]
          assert.equal(value, expected)
        })
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
            n,
          },
          undefined,
          2
        )
      )
      return false
    }
  }

  return true
}

let seed = 0
while (seed < 1000) {
  if (!fuzz(seed++)) {
    break
  }
}

console.log('seed', seed)
