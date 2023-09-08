function isReadableNodeStream(obj, strict = false) {
  return !!(
    (
      obj &&
      typeof obj.pipe === 'function' &&
      typeof obj.on === 'function' &&
      (!strict || (typeof obj.pause === 'function' && typeof obj.resume === 'function')) &&
      (!obj._writableState || obj._readableState?.readable !== false) && // Duplex
      (!obj._writableState || obj._readableState)
    ) // Writable has .pipe.
  )
}

function isStream(obj) {
  return (
    obj && typeof obj === 'object' && typeof obj.pipe === 'function' && typeof obj.on === 'function'
  )
}

function readableStreamLength(stream) {
  if (!isReadableNodeStream(stream)) {
    return null
  }

  stream.read(0)

  const state = stream._readableState
  return state && state.ended === true && Number.isFinite(state.length) ? state.length : null
}

module.exports = {
  isStream,
  isReadableNodeStream,
  readableStreamLength,
}
