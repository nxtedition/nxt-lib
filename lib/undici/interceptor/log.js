const { parseHeaders } = require('../../../http.js')
const xuid = require('xuid')
const { performance } = require('perf_hooks')

class Handler {
  constructor(opts, { handler }) {
    this.handler = handler
    this.opts = opts.id ? opts : { ...opts, id: xuid() }
    this.abort = null
    this.aborted = false
    this.logger = opts.logger.child({ ureq: { id: opts.id } })
    this.pos = 0
    this.startTime = 0
  }

  onConnect(abort) {
    this.abort = abort
    this.startTime = performance.now()
    this.logger.debug({ ureq: this.opts }, 'upstream request started')
    this.handler.onConnect?.((reason) => {
      this.aborted = true
      this.abort(reason)
    })
  }

  onBodySent(chunk) {
    return this.handler.onBodySent?.(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    this.logger.debug(
      {
        ures: { statusCode, headers: parseHeaders(rawHeaders) },
        elapsedTime: this.startTime - performance.now(),
      },
      'upstream request response',
    )
    return this.handler.onHeaders?.(statusCode, rawHeaders, resume, statusMessage)
  }

  onData(chunk) {
    this.pos += chunk.length
    return this.handler.onData?.(chunk)
  }

  onComplete(rawTrailers) {
    this.logger.debug(
      { bytesRead: this.pos, elapsedTime: this.startTime - performance.now() },
      'upstream request completed',
    )
    return this.handler.onComplete?.(rawTrailers)
  }

  onError(err) {
    if (this.aborted) {
      this.logger.debug(
        { bytesRead: this.pos, elapsedTime: this.startTime - performance.now(), err },
        'upstream request aborted',
      )
    } else {
      this.logger.error(
        { bytesRead: this.pos, elapsedTime: this.startTime - performance.now(), err },
        'upstream request failed',
      )
    }
    return this.handler.onError?.(err)
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.logger ? dispatch(opts, new Handler(opts, { handler })) : dispatch(opts, handler)
