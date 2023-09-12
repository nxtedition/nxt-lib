const crypto = require('node:crypto')
const { findHeader } = require('../utils')

class Handler {
  constructor(opts, { handler }) {
    this.handler = handler
    this.hash = opts.hash
    this.hasher = null
  }

  onConnect(abort) {
    return this.handler.onConnect(abort)
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    this.hash = findHeader(rawHeaders, 'content-md5') ?? this.hash
    this.hasher = this.hash !== undefined ? crypto.createHash('md5') : null
    return this.handler.onHeaders(statusCode, rawHeaders, resume, statusMessage)
  }

  onData(chunk) {
    this.hasher?.update(chunk)
    return this.handler.onData(chunk)
  }

  onComplete(rawTrailers) {
    return this.hasher != null && this.hasher.digest('base64') !== this.hash
      ? this.handler.onError(new Error('Content-MD5 mismatch'))
      : this.handler.onComplete(rawTrailers)
  }

  onError(err) {
    this.handler.onError(err)
  }
}

module.exports = (dispatch) => (opts, handler) => dispatch(opts, new Handler(opts, { handler }))
