const { AbortError } = require('../../errors')

class Handler {
  constructor(opts, { handler }) {
    this.handler = handler
    this.pos = 0
  }

  onConnect(abort) {
    this.abort = abort
    return this.handler.onConnect(abort)
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    return this.handler.onHeaders(statusCode, rawHeaders, resume, statusMessage)
  }

  onData(chunk) {
    this.pos += chunk.length
    if (this.pos < 128 * 1024) {
      return true
    }

    this.handler.onComplete([])
    this.handler = null

    this.abort(new AbortError('dump'))

    return false
  }

  onComplete(rawTrailers) {
    return this.handler.onComplete([])
  }

  onError(err) {
    return this.handler?.onError(err)
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.dump ? dispatch(opts, new Handler(opts, { handler })) : dispatch(opts, handler)
