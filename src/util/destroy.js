const once = require('once')

const noop = () => {}
module.exports = function destroy (self, err, callback) {
  callback = callback ? once(callback) : null
  self.on('error', callback || noop)
  if (self.abort) {
    self.abort()
  } else {
    self.destroy(err, callback)
  }
}
