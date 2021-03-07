const { finished } = require('stream')
const { kDestroyed } = require('./symbols')
const { IncomingMessage } = require('http')

function isStream(body) {
  return !!(body && typeof body.on === 'function')
}

function isDestroyed(stream) {
  return !stream || !!(stream.destroyed || stream[kDestroyed])
}

function destroy(stream, err, callback) {
  if (typeof err === 'function') {
    callback = err
    err = null
  }

  if (!callback) {
    callback = () => {}
  }

  if (!isStream(stream) || isDestroyed(stream)) {
    process.nextTick(callback)
    return
  }

  if (typeof stream.destroy === 'function') {
    finished(stream, (err) => callback(err || null))
    if (err || Object.getPrototypeOf(stream).constructor !== IncomingMessage) {
      stream.destroy(err)
    }
  } else if (err) {
    process.nextTick(
      (stream, err) => {
        stream.emit('error', err)
        process.nextTick(callback, err)
      },
      stream,
      err
    )
  } else {
    setImmediate(callback)
  }

  if (stream.destroyed !== true) {
    stream[kDestroyed] = true
  }
}

module.exports = destroy
