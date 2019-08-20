const once = require('once')
const noop = () => {}
// If you want to know about errors, pass callback.
module.exports = function destroy (self, err, callback) {
  callback = callback ? once(callback) : null
  self.on('error', callback || noop)
  if (typeof self.abort === 'function') {
    self.abort() // Fix for ClientRequest.
  } else {
    self.destroy(err, callback)
  }
}
