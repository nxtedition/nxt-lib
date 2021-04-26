const fsp = require('fs/promises')

module.exports.readGenerator = async function* (filePath, { start = 0, end } = {}) {
  const fd = await fsp.open(filePath)
  try {
    let pos = start
    while (true) {
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
