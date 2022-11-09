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

function align8(value) {
  return (value | 0x7) + 1
}

let poolSize = 1024 * 1024
let poolOffset = 0
let poolBuffer = Buffer.allocUnsafeSlow(poolSize).buffer

async function reader({ sharedState, sharedBuffer, logger }, cb) {
  const state = new Int32Array(sharedState)
  const buffer32 = new Int32Array(sharedBuffer)
  const size = align8(sharedBuffer.byteLength) - 16
  const buffer = Buffer.from(sharedBuffer, 0, size)
  const yieldLen = 256 * 1024

  let readPos = 0
  let writePos = 0
  let yieldPos = readPos + yieldLen

  while (true) {
    while (readPos !== writePos) {
      const dataLen = buffer32[readPos >> 2]
      const dataPos = readPos + 4

      if (dataLen < 0) {
        readPos = 0
        continue
      }

      assert(dataLen >= 0)
      assert(dataLen + 4 <= size)
      assert(dataPos + dataLen <= size)

      const thenable = cb(buffer, dataPos, dataLen)
      if (thenable) {
        Atomics.notify(state, READ_INDEX)
        await thenable
      }

      readPos = align8(readPos + dataLen + 4) % size
      Atomics.store(state, READ_INDEX, readPos)

      // Yield to IO sometimes.
      if (readPos >= yieldPos) {
        yieldPos = readPos + yieldLen
        Atomics.notify(state, READ_INDEX)
        await tp.setImmediate()
      }
    }

    writePos = Atomics.load(state, WRITE_INDEX)
    if (readPos === writePos) {
      const { async, value } = Atomics.waitAsync(state, WRITE_INDEX, writePos)
      if (async) {
        await value
      }
      writePos = Atomics.load(state, WRITE_INDEX)
    }
  }
}

function writer({ sharedState, sharedBuffer, logger }) {
  const state = new Int32Array(sharedState)
  const buffer32 = new Int32Array(sharedBuffer)
  const size = align8(sharedBuffer.byteLength) - 16
  const buffer = Buffer.from(sharedBuffer, 0, size)
  const queue = []

  let writePos = 0
  let readPos = 0
  let notifying = false

  function notifyNT() {
    notifying = false
    Atomics.notify(state, WRITE_INDEX)
  }

  async function flush() {
    while (queue.length) {
      if (tryWrite(queue[0].byteLength, (pos, dst, data) => pos + data.copy(dst, pos), queue[0])) {
        queue.shift() // TODO (perf): Array.shift is slow for large arrays...
      } else {
        const { async, value } = Atomics.waitAsync(state, READ_INDEX, readPos)
        if (async) {
          await value
        }
        readPos = Atomics.load(state, READ_INDEX)
      }
    }
  }

  function tryWrite(len, fn, arg1, arg2, arg3) {
    const required = len + 4

    let sequential
    let available

    if (writePos >= readPos) {
      // |----RxxxxxxW---|
      available = readPos + (size - writePos)
      sequential = size - writePos
    } else {
      // |xxxxW------Rxxx|
      available = writePos + (size - readPos)
      sequential = readPos - writePos
    }

    assert(required <= size)
    assert((writePos & 0x7) === 0)

    if (available < required) {
      return false
    }

    if (sequential < required) {
      buffer32[writePos >> 2] = -1
      writePos = 0
      notifyNT()
      return tryWrite(len, fn, arg1, arg2, arg3)
    }

    const dataPos = writePos + 4
    const dataLen = fn(dataPos, buffer, arg1, arg2, arg3) - dataPos

    if (dataLen < 0 || dataLen > len) {
      logger?.error({ err: new Error('invalid data size'), len, dataLen })
    }

    assert(dataPos + dataLen <= size)
    assert((dataPos & 0x3) === 0)

    buffer32[writePos >> 2] = dataLen

    writePos = align8(writePos + dataLen + 4) % size
    Atomics.store(state, WRITE_INDEX, writePos)

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
