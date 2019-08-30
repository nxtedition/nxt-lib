const once = require('once')
const noop = () => {}
// If you want to know about errors, pass callback.
module.exports = function destroy (self, err, callback) {
  callback = callback ? once(callback) : null
  // Ensure no uncaught exception if we don't care about errors.
  self.on('error', callback || noop)
  if (callback) {
    self
      // node doesn't always implement destroy with callback
      .on('close', callback)
      // node doesn't always emit 'close' after 'aborted'
      // aborted should be ECONNRESET.
      .on('aborted', () => {
        const err = new Error('aborted')
        err.code = 'ECONNRESET'
        callback(err)
      })
      // node doesn't always emit 'close'
      .on('end', callback)
  }
  if (typeof self.abort === 'function') {
    self.abort() // Fix for ClientRequest.
  } else {
    self.destroy(err, callback)
  }
}
