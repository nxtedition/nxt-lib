const fsp = require('fs/promises')
const crypto = require('crypto')

module.exports.readGenerator = async function* (filePath, { start = 0, end } = {}) {
  // TODO (fix): More arg validation.

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

module.export = async function hashFile(filePath, { signal, algorithm = 'md5' } = {}) {
  // TODO (fix): More arg validation.

  if (signal?.aborted) {
    throw new Error('aborted')
  }

  const hasher = crypto.createHash(algorithm)
  for await (const buf of module.exports.readGenerator(filePath)) {
    if (signal?.aborted) {
      throw new Error('aborted')
    }
    hasher.update(buf)
  }
  return hasher.digest()
}
