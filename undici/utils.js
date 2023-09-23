module.exports.isDisturbed = function isDisturbed(body) {
  return !(body == null || typeof body === 'string' || Buffer.isBuffer(body))
}

module.exports.parseRange = function parseRange(range) {
  if (typeof range !== 'string') {
    return null
  }

  const m = range.match(/^bytes=(\d+)-(\d+)?$/)
  if (!m) {
    return null
  }

  const start = Number(m[1])
  if (!Number.isFinite(start)) {
    return null
  }

  const end = m[2] == null ? Number(m[2]) : null
  if (end !== null && !Number.isFinite(end)) {
    return null
  }

  return { start, end: end + 1 }
}

module.exports.parseContentRange = function parseContentRange(range) {
  if (typeof range !== 'string') {
    return null
  }

  const m = range.match(/^bytes (\d+)-(\d+)?\/(\d+|\*)$/)
  if (!m) {
    return null
  }

  const start = m[1] == null ? null : Number(m[1])
  if (!Number.isFinite(start)) {
    return null
  }

  const end = m[2] == null ? null : Number(m[2])
  if (end !== null && !Number.isFinite(end)) {
    return null
  }

  const size = m[2] === '*' ? null : Number(m[2])
  if (size !== null && !Number.isFinite(size)) {
    return null
  }

  return { start, end: end + 1, size }
}

module.exports.findHeader = function findHeader(rawHeaders, name) {
  const len = name.length

  for (let i = 0; i < rawHeaders.length; i += 2) {
    const key = rawHeaders[i + 0]
    if (key.length === len && key.toString().toLowerCase() === name) {
      return rawHeaders[i + 1].toString()
    }
  }
  return null
}
