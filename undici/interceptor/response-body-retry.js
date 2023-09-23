const assert = require('node:assert')
const {
  parseContentRange,
  isDisturbed,
  findHeader,
  retryAfter: retryAfterFn,
} = require('../utils.js')

class Handler {
  constructor(opts, { dispatch, handler }) {
    this.dispatch = dispatch
    this.handler = handler
    this.opts = opts
    this.abort = null
    this.aborted = false

    this.count = 0
    this.pos = 0
    this.end = null
    this.error = null
    this.etag = null
  }

  onConnect(abort) {
    this.abort = abort
    this.handler.onConnect((reason) => {
      this.aborted = true
      this.abort(reason)
    })
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    const etag = findHeader(rawHeaders, 'etag')

    if (this.resume) {
      this.resume = null

      // TODO (fix): Support other statusCode with skip?
      if (statusCode !== 206) {
        throw this.error
      }

      // TODO (fix): strict vs weak etag?
      if (this.etag == null || this.etag !== etag) {
        throw this.error
      }

      const contentRange = parseContentRange(findHeader(rawHeaders, 'content-range'))
      if (!contentRange) {
        throw this.error
      }

      const { start, size, end = size } = contentRange

      assert(this.pos === start, 'content-range mismatch')
      assert(this.end == null || this.end === end, 'content-range mismatch')

      this.resume = resume
      return true
    }

    if (this.end == null) {
      if (statusCode === 206) {
        const contentRange = parseContentRange(findHeader(rawHeaders, 'content-range'))
        if (!contentRange) {
          return this.handler.onHeaders(statusCode, rawHeaders, () => this.resume(), statusMessage)
        }

        const { start, size, end = size } = contentRange

        this.end = end
        this.pos = Number(start)
      } else {
        const contentLength = findHeader(rawHeaders, 'content-length')
        if (contentLength) {
          this.end = Number(contentLength)
        }
      }

      assert(Number.isFinite(this.pos))
      assert(this.end == null || Number.isFinite(this.end), 'invalid content-length')
    }

    this.etag = etag
    this.resume = resume
    return this.handler.onHeaders(statusCode, rawHeaders, () => this.resume(), statusMessage)
  }

  onData(chunk) {
    this.pos += chunk.length
    this.count = 0
    return this.handler.onData(chunk)
  }

  onComplete(rawTrailers) {
    return this.handler.onComplete(rawTrailers)
  }

  onError(err) {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    if (!this.resume || this.aborted || !this.etag || isDisturbed(this.opts.body)) {
      return this.handler.onError(err)
    }

    const retryAfter = retryAfterFn(err, this.count++, this.opts)
    if (retryAfter == null) {
      return this.handler.onError(err)
    }
    assert(Number.isFinite(retryAfter), 'invalid retry')

    this.error = err
    this.opts = {
      ...this.opts,
      headers: {
        ...this.opts.headers,
        range: `bytes=${this.pos}-${this.end ?? ''}`,
      },
    }

    this.opts.logger?.debug('retrying response body', { retryAfter })

    this.timeout = setTimeout(() => {
      this.timeout = null
      try {
        this.dispatch(this.opts, this)
      } catch (err) {
        this.handler.onError(err)
      }
    }, retryAfter)
  }
}

module.exports = (dispatch) => (opts, handler) => {
  return opts.idempotent && opts.retry && opts.method === 'GET'
    ? dispatch(opts, new Handler(opts, { handler, dispatch }))
    : dispatch(opts, handler)
}
