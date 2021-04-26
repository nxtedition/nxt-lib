const fsp = require('fs/promises')
const { AbortError } = require('errors')

module.exports.readGenerator = async function* (filePath, { start = 0, end, signal } = {}) {
  if (signal?.aborted) {
    throw new AbortError()
  }

  const fd = await fsp.open(filePath)
  try {
    let pos = start
    while (true) {
      if (signal?.aborted) {
        throw new AbortError()
      }

      if (end && pos >= end) {
        break
      }

      const { buffer, bytesRead } = await this.read({
        buffer: Buffer.allocUnsafe(end ? Math.min(end - pos, 65536) : 65536),
        position: pos,
      })

      if (bytesRead === 0) {
        return
      }

      if (bytesRead !== buffer.length) {
        // Slow path. Shrink to fit.
        // Copy instead of slice so that we don't retain
        // large backing buffer for small reads.
        const dst = Buffer.allocUnsafeSlow(bytesRead)
        buffer.copy(dst, 0, 0, bytesRead)
        yield dst
      } else {
        yield buffer
      }

      pos += bytesRead
    }
  } finally {
    await fd.close()
  }
}
