const { AbortError } = require('../../errors')

class Handler {
  constructor(opts, { handler }) {
    this.handler = handler
    this.pos = 0
    this.reason = null
  }

  onConnect(abort) {
    this.abort = abort
    this.handler.onConnect((reason) => {
      this.reason = reason ?? new AbortError()
    })
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    return this.reason == null
      ? this.handler.onHeaders(statusCode, rawHeaders, resume, statusMessage)
      : true
  }

  onData(chunk) {
    if (this.reason == null) {
      return this.handler.onData(chunk)
    }

    this.pos += chunk.length
    if (this.pos < 128 * 1024) {
      return true
    }

    this.abort(this.reason)

    return false
  }

  onComplete(rawTrailers) {
    if (this.reason == null) {
      return this.handler.onComplete(rawTrailers)
    } else {
      return this.handler.onError(this.reason)
    }
  }

  onError(err) {
    return this.handler.onError(err)
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.dump ? dispatch(opts, new Handler(opts, { handler })) : dispatch(opts, handler)
