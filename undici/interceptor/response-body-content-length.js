const { findHeader } = require('../utils')

class Handler {
  constructor(opts, { handler }) {
    this.handler = handler
    this.len = null
    this.pos = 0
  }

  onConnect(abort) {
    return this.handler.onConnect(abort)
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    this.len = findHeader(rawHeaders, 'content-length')
    return this.handler.onHeaders(statusCode, rawHeaders, resume, statusMessage)
  }

  onData(chunk) {
    this.pos += chunk.length
    return this.handler.onData(chunk)
  }

  onComplete(rawTrailers) {
    return this.len != null && this.pos !== Number(this.len)
      ? this.handler.onError(new Error('Content-Length mismatch'))
      : this.handler.onComplete(rawTrailers)
  }

  onError(err) {
    return this.handler.onError(err)
  }
}

module.exports = (dispatch) => (opts, handler) => dispatch(opts, new Handler(opts, { handler }))
