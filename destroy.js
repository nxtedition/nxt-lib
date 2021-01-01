const { finished } = require('stream')
const noop = () => {}

// If you want to know about errors, pass callback.
module.exports = function destroy (self, err, callback) {
  if (typeof err === 'function') {
    callback = err
    err = null
  }
  finished(self, callback || noop)
  self.destroy(err)
}
