const assert = require('node:assert')

// Make sure write and read are in different
// cache lines.
const WRITE_INDEX = 0
const READ_INDEX = 16

function alloc(size) {
  return {
    sharedState: new SharedArrayBuffer(128),
    sharedBuffer: new SharedArrayBuffer(size),
  }
}

let poolSize = 1024 * 1024
let poolOffset = 0
let poolBuffer = Buffer.allocUnsafeSlow(poolSize).buffer

function reader({ sharedState, sharedBuffer }) {
  const state = new Int32Array(sharedState)
  const buffer32 = new Int32Array(sharedBuffer)
  const size = sharedBuffer.byteLength
  const buffer = Buffer.from(sharedBuffer, 0, size)

  let readPos = Atomics.load(state, READ_INDEX)
  let flushing = false

  function flush() {
    flushing = false
    Atomics.store(state, READ_INDEX, readPos)
  }

  return function read(cb, arg1, arg2, arg3) {
    const writePos = Atomics.load(state, WRITE_INDEX)
    if (readPos === writePos) {
      return 0
    }

    let counter = 0
    while (readPos !== writePos) {
      const dataLen = buffer32[readPos >> 2]
      const dataPos = readPos + 4

      if (dataLen < 0) {
        readPos = 0
        break
      }

      assert(dataLen >= 0)
      assert(dataPos + dataLen <= size)

      readPos = dataPos + dataLen
      if (readPos & 0x7) {
        readPos |= 0x7
        readPos += 1
      }

      if (readPos + 4 >= size) {
        readPos = 0
      }

      assert(readPos + 4 < size)

      counter += 1
      const ret = cb(buffer, dataPos, dataLen, arg1, arg2, arg3)
      if (ret === false) {
        break
      }
    }

    if (!flushing) {
      flushing = true
      process.nextTick(flush)
    }

    return counter
  }
}

function writer({ sharedState, sharedBuffer }) {
  const state = new Int32Array(sharedState)
  const buffer32 = new Int32Array(sharedBuffer)
  const size = sharedBuffer.byteLength
  const buffer = Buffer.from(sharedBuffer, 0, size)

  let queue = null

  let readPos = Atomics.load(state, READ_INDEX)
  let writePos = Atomics.load(state, WRITE_INDEX)
  let flushing = false

  function flush() {
    flushing = false
    readPos = Atomics.load(state, READ_INDEX)
    Atomics.store(state, WRITE_INDEX, writePos)
  }

  function flushQueue() {
    while (queue.length) {
      if (tryWrite(queue[0].byteLength, (pos, dst, data) => pos + data.copy(dst, pos), queue[0])) {
        queue.shift() // TODO (perf): Array.shift is slow for large arrays...
      } else {
        setTimeout(flushQueue, 100)
        return
      }
    }
    queue = null
  }

  function tryWrite(len, fn, arg1, arg2, arg3) {
    // TODO (fix): +32 is a hack to ensure we dont cross buffer size or readPos.
    const required = len + 4 + 32

    assert(required <= size)

    let available
    if (writePos >= readPos) {
      // 0----RxxxxxxW---S

      const sequential = size - writePos
      if (sequential < required) {
        buffer32[writePos >> 2] = -1
        writePos = 0
        available = readPos
      } else {
        available = readPos + (size - writePos)
      }
    } else {
      // 0xxxxW------RxxxS
      available = readPos - writePos
    }

    if (available < required) {
      return false
    }

    const dataPos = writePos + 4
    const dataLen = fn(dataPos, buffer, arg1, arg2, arg3) - dataPos

    assert(dataLen <= len + 4)
    assert(dataLen >= 0)
    assert(dataPos + dataLen <= size)

    buffer32[writePos >> 2] = dataLen

    writePos = dataPos + dataLen
    if (writePos & 0x7) {
      writePos |= 0x7
      writePos += 1
    }

    assert(writePos <= size)
    assert(writePos !== readPos)

    if (!flushing) {
      flushing = true
      process.nextTick(flush)
    }

    return true
  }

  return function write(len, fn, arg1, arg2, arg3) {
    const required = len + 4 + 8 + 8

    assert(required >= 0)
    assert(required <= size)

    if (queue == null && tryWrite(len, fn, arg1, arg2, arg3)) {
      return true
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
    if (poolOffset & 0x7) {
      poolOffset |= 0x7
      poolOffset += 1
    }

    if (!queue) {
      queue = []
      queueMicrotask(flushQueue)
    }
    queue.push(buf)

    return false
  }
}

module.exports = {
  alloc,
  reader,
  writer,
}
