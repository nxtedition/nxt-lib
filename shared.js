const assert = require('node:assert')
const tp = require('node:timers/promises')

const WRITE_INDEX = 0
const READ_INDEX = 1

function alloc(size) {
  return {
    sharedState: new SharedArrayBuffer(16),
    sharedBuffer: new SharedArrayBuffer(size),
  }
}

let poolSize = 1024 * 1024
let poolOffset = 0
let poolBuffer = Buffer.allocUnsafeSlow(poolSize).buffer

// TODO (fix): Max number of bytes written/read is 2^53-1 which
// is enough for 1 MiB/s for 285 years or 1 GiB/s per 0.285 years.
// Total amount of that is split between all workers. With 16
// workers the above increases to 4560 and 4.560 years. Being able
// to handle infinite amount of data would be preferrable but is
// more complicated.

async function reader({ sharedState, sharedBuffer }, cb) {
  const state = new BigInt64Array(sharedState)
  const buffer = Buffer.from(sharedBuffer)
  const size = buffer.byteLength - 4
  const yieldLen = 256 * 1024

  let readPos = 0
  let writePos = 0
  let yieldPos = readPos + yieldLen

  function notifyNT() {
    Atomics.store(state, READ_INDEX, BigInt(readPos))
    Atomics.notify(state, READ_INDEX)
  }

  while (true) {
    while (readPos < writePos) {
      const dataPos = (readPos % size) + 4
      const dataLen = buffer.readInt32LE(dataPos - 4)

      if (dataLen < 0) {
        readPos -= dataLen
      } else {
        assert(dataLen >= 0)
        assert(dataLen + 4 <= size)
        assert(dataPos + dataLen <= size)

        const buffer = Buffer.from(sharedBuffer, dataPos, dataLen)
        const thenable = cb(buffer)
        if (thenable) {
          notifyNT()
          await thenable
        }
        readPos += dataLen + 4
      }

      // Yield to IO sometimes.
      if (readPos >= yieldPos) {
        yieldPos = readPos + yieldLen
        notifyNT()
        await tp.setImmediate()
      }
    }

    const { async, value } = Atomics.waitAsync(state, WRITE_INDEX, BigInt(writePos))
    if (async) {
      notifyNT()
      await value
    }
    writePos = Number(Atomics.load(state, WRITE_INDEX))
  }
}

function writer({ sharedState, sharedBuffer, logger }) {
  const state = new BigInt64Array(sharedState)
  const buffer = Buffer.from(sharedBuffer)
  const size = buffer.byteLength - 4
  const queue = []

  let writePos = 0
  let readPos = 0
  let notifying = false

  function notifyNT() {
    Atomics.store(state, WRITE_INDEX, BigInt(writePos))
    Atomics.notify(state, WRITE_INDEX)
    notifying = false
  }

  async function flush() {
    while (queue.length) {
      if (tryWrite(queue[0].byteLength, (pos, dst, data) => pos + data.copy(dst, pos), queue[0])) {
        queue.shift() // TODO (perf): Array.shift is slow for large arrays...
      } else {
        const { async, value } = Atomics.waitAsync(state, READ_INDEX, BigInt(readPos), 1e3)
        if (async) {
          await value
        }
        readPos = Number(Atomics.load(state, READ_INDEX))
      }
    }
  }

  function tryWrite(len, fn, arg1, arg2, arg3) {
    const required = len + 4
    const used = writePos - readPos
    const available = size - used
    const position = writePos % size
    const sequential = size - position

    assert(required <= size)

    if (available < required) {
      return false
    }

    if (sequential < required) {
      buffer.writeInt32LE(-sequential, position)
      writePos += sequential
      notifyNT()
      return tryWrite(len, fn, arg1, arg2, arg3)
    }

    const dataPos = position + 4
    const dataLen = fn(dataPos, buffer, arg1, arg2, arg3) - dataPos

    if (dataLen < 0 || dataLen > len) {
      logger?.error({ err: new Error('invalid data size'), len, dataLen })
    }

    assert(dataPos + dataLen <= size)

    buffer.writeInt32LE(dataLen, dataPos - 4)
    writePos += dataLen + 4

    if (!notifying) {
      notifying = true
      queueMicrotask(notifyNT)
    }

    return true
  }

  function write(len, fn, arg1, arg2, arg3) {
    assert(len >= 0)
    assert(len + 4 <= size)

    if (!queue.length && tryWrite(len, fn, arg1, arg2, arg3)) {
      return
    }

    // len is usually significantly overprovisioned to account for "worst" case.
    // Therefore it is important that we use a pool as to not overallocate by
    // several orders of magnitude.

    if (len > poolSize - poolOffset) {
      poolSize = Math.max(poolSize, len)
      poolOffset = 0
      poolBuffer = Buffer.allocUnsafeSlow(poolSize).buffer
    }

    const pos = fn(0, Buffer.from(poolBuffer, poolOffset, len), arg1, arg2, arg3)
    const buf = Buffer.from(poolBuffer, poolOffset, pos)

    poolOffset += pos

    // Ensure aligned slices
    if (poolOffset & 0x7) {
      poolOffset |= 0x7
      poolOffset += 1
    }

    queue.push(buf)
    if (queue.length === 1) {
      setImmediate(flush)
    }
  }

  return {
    write,
    get pending() {
      return queue.length
    },
  }
}

module.exports = {
  alloc,
  reader,
  writer,
}
