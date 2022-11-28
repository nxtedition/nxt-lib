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

function getSize(sharedBuffer) {
  // -4 is required so that we can always write the -1 flag.
  return sharedBuffer.byteLength - 4
}

let poolSize = 1024 * 1024
let poolOffset = 0
let poolBuffer = Buffer.allocUnsafeSlow(poolSize).buffer

function reader({ sharedState, sharedBuffer }) {
  const state = new Int32Array(sharedState)
  const size = getSize(sharedBuffer)
  const buffer = Buffer.from(sharedBuffer, 0, size)

  let readPos = Atomics.load(state, READ_INDEX)
  let notifying = false

  function notify() {
    notifying = false
    Atomics.store(state, READ_INDEX, readPos)
  }

  return function read(cb, arg1, arg2, arg3) {
    let counter = 0

    const writePos = Atomics.load(state, WRITE_INDEX)
    for (let n = 0; n < 1024 && readPos !== writePos; n++) {
      const dataPos = readPos + 4
      const dataLen = buffer.readInt32LE(dataPos - 4) // TODO (perf): Int32Array

      if (!notifying) {
        notifying = true
        process.nextTick(notify)
      }

      if (dataLen === -1) {
        readPos = 0
      } else {
        assert(dataLen >= 0)
        assert(dataPos + dataLen <= size)

        readPos += 4 + dataLen
        counter += 1
        if (cb(buffer, dataPos, dataLen, arg1, arg2, arg3) === false) {
          break
        }
      }
    }

    return counter
  }
}

function writer({ sharedState, sharedBuffer }) {
  const state = new Int32Array(sharedState)
  const size = getSize(sharedBuffer)
  const buffer = Buffer.from(sharedBuffer, 0, size)

  let queue = null

  let readPos = Atomics.load(state, READ_INDEX)
  let writePos = Atomics.load(state, WRITE_INDEX)
  let notifying = false

  function notify() {
    notifying = false
    readPos = Atomics.load(state, READ_INDEX)
    Atomics.store(state, WRITE_INDEX, writePos)
  }

  function flush() {
    while (queue.length) {
      if (tryWrite(queue[0].byteLength, (pos, dst, data) => pos + data.copy(dst, pos), queue[0])) {
        queue.shift() // TODO (perf): Array.shift is slow for large arrays...
      } else {
        setTimeout(flush, 100)
        return
      }
    }
    queue = null
  }

  function hasSpace(len) {
    const required = len + 4

    assert(required >= 0)
    assert(required <= size)

    if (writePos >= readPos) {
      // 0----RxxxxxxW---S

      const sequential = size - writePos
      if (sequential >= required) {
        return true
      }

      buffer.writeInt32LE(-1, writePos)
      writePos = 0
      Atomics.store(state, WRITE_INDEX, writePos)
    } else {
      // 0xxxxW------RxxxS
    }

    const available = readPos - writePos
    return available >= required
  }

  function tryWrite(len, fn, arg1, arg2, arg3) {
    if (!hasSpace(len)) {
      return false
    }

    const dataPos = writePos + 4
    const dataLen = fn(dataPos, buffer, arg1, arg2, arg3) - dataPos

    assert(dataLen <= len + 4)
    assert(dataLen >= 0)
    assert(dataPos + dataLen <= size)

    buffer.writeInt32LE(dataLen, dataPos - 4) // TODO (perf): Int32Array
    writePos += 4 + dataLen

    assert(writePos <= size)
    assert(writePos !== readPos)

    // TODO (perf): Align writePos

    if (!notifying) {
      notifying = true
      process.nextTick(notify)
    }

    return true
  }

  return function write(len, fn, arg1, arg2, arg3) {
    const required = len + 4 + 32

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
      queueMicrotask(flush)
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
