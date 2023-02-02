const stream = require('stream')

function nop() {}

module.exports = async function* batched(src) {
  let callback = nop

  function next(resolve) {
    if (this === src) {
      callback()
      callback = nop
    } else {
      callback = resolve
    }
  }

  src.on('readable', next)

  let error
  stream.finished(src, { writable: false }, (err) => {
    // error = err ? aggregateTwoErrors(error, err) : null;
    error = err
    callback()
    callback = nop
  })

  try {
    let batch = []
    while (true) {
      const chunk = src.destroyed ? null : src.read()
      if (chunk !== null) {
        batch.push(chunk)
      } else if (batch.length) {
        yield batch
        batch = []
      } else if (error) {
        throw error
      } else if (error === null) {
        return
      } else {
        await new Promise(next)
      }
    }
  } finally {
    src.destroy(error).on('error', () => {})
  }
}
