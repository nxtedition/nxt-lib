const assert = require('node:assert')
const tp = require('node:timers/promises')

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
  const size = sharedBuffer.byteLength
  const buffer = Buffer.from(sharedBuffer, 0, size)

  let readPos = Atomics.load(state, READ_INDEX)
  let notifying = false

  function notify() {
    notifying = false
    Atomics.store(state, READ_INDEX, readPos)
  }

  function read(cb, arg1, arg2, arg3) {
    let counter = 0

    const writePos = Atomics.load(state, WRITE_INDEX)
    for (let n = 0; n < 1024 && readPos !== writePos; n++) {
      const dataPos = readPos + 4
      const dataLen = buffer.readInt32LE(dataPos - 4) // TODO (perf): Int32Array

      if (!notifying) {
        notifying = true
        // Defer notify so that the returned buffers are valid for at least
        // one tick.
        queueMicrotask(notify)
      }

      if (dataLen === -1) {
        readPos = 0
      } else {
        assert(dataLen >= 0)
        assert(dataPos + dataLen <= size)

        readPos += 4 + dataLen
        if (readPos & 0x3) {
          readPos |= 0x3
          readPos += 1
        }

        counter += 1
        if (cb(buffer, dataPos, dataLen, arg1, arg2, arg3) === false) {
          break
        }
      }
    }

    return counter
  }

  return {
    read,
  }
}

function writer({ sharedState, sharedBuffer }) {
  const state = new Int32Array(sharedState)
  const size = sharedBuffer.byteLength
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

  async function flush() {
    while (queue.length) {
      if (syncWrite(queue[0].byteLength, (pos, dst, data) => pos + data.copy(dst, pos), queue[0])) {
        queue.shift() // TODO (perf): Array.shift is slow for large arrays...
      } else {
        await tp.setTimeout(100)
      }
    }
    queue = null
  }

  function hasSpace(len) {
    // len + {current packet header} + {next packet header} + 4 byte alignment
    const required = len + 4 + 4 + 4

    assert(required >= 0)
    assert(required <= size)

    if (writePos >= readPos) {
      // 0----RxxxxxxW---S
      if (size - writePos >= required) {
        return true
      }

      if (readPos === 0) {
        return false
      }

      buffer.writeInt32LE(-1, writePos)
      writePos = 0
      Atomics.store(state, WRITE_INDEX, writePos)
    }

    // 0xxxxW------RxxxS
    return readPos - writePos >= required
  }

  function syncWrite(len, fn, arg1, arg2, arg3) {
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
    if (writePos & 0x3) {
      writePos |= 0x3
      writePos += 1
    }

    assert(writePos + 4 <= size) // must have room for next header also
    assert(writePos !== readPos)

    if (!notifying) {
      notifying = true
      queueMicrotask(notify)
    }

    return true
  }

  function asyncWrite(len, fn, arg1, arg2, arg3) {
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
  }

  function write(len, fn, arg1, arg2, arg3) {
    // len + {current packet header} + {next packet header} + 4 byte alignment
    const required = len + 4 + 4 + 4

    assert(required >= 0)
    assert(required <= size)

    if (queue != null || !syncWrite(len, fn, arg1, arg2, arg3)) {
      asyncWrite(len, fn, arg1, arg2, arg3)
    }
  }

  return {
    write,
    notify,
  }
}

module.exports = {
  alloc,
  reader,
  writer,
}
