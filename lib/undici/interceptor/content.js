const crypto = require('node:crypto')
const stream = require('node:stream')
const assert = require('node:assert')
const { findHeader } = require('../utils')
const { isStream } = require('../../../stream')

class Handler {
  constructor(opts, { handler }) {
    this.handler = handler
    this.md5 = null
    this.length = null

    this.hasher = null
    this.pos = 0
  }

  onConnect(abort) {
    return this.handler.onConnect?.(abort)
  }

  onBodySent(chunk) {
    return this.handler.onBodySent?.(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    this.md5 = findHeader(rawHeaders, 'content-md5')
    this.length = findHeader(rawHeaders, 'content-length')

    this.hasher = this.md5 != null ? crypto.createHash('md5') : null

    return this.handler.onHeaders?.(statusCode, rawHeaders, resume, statusMessage)
  }

  onData(chunk) {
    this.pos += chunk.length
    this.hasher?.update(chunk)
    return this.handler.onData?.(chunk)
  }

  onComplete(rawTrailers) {
    const hash = this.hasher?.digest('base64')
    if (this.md5 != null && hash !== this.md5) {
      this.handler.onError?.(
        Object.assign(new Error('Request Content-Length mismatch'), {
          expected: this.md5,
          actual: hash,
        }),
      )
    }
    if (this.length != null && this.pos !== Number(this.length)) {
      return this.handler.onError?.(
        Object.assign(new Error('Request Content-Length mismatch'), {
          expected: Number(this.length),
          actual: this.pos,
        }),
      )
    }
    return this.handler.onComplete?.(rawTrailers)
  }

  onError(err) {
    this.handler.onError?.(err)
  }
}

module.exports = (dispatch) => (opts, handler) => {
  const md5 = opts.headers?.['content-md5'] ?? opts.headers?.['Content-MD5']
  const length = opts.headers?.['content-lenght'] ?? opts.headers?.['Content-Length']

  if (md5 == null && length == null) {
    return dispatch(opts, new Handler(opts, { handler }))
  }

  if (isStream(opts.body)) {
    const hasher = md5 ? crypto.createHash('md5') : null
    let pos = 0

    opts = {
      ...opts,
      body: stream.pipeline(
        opts.body,
        new stream.Transform({
          transform(chunk, encoding, callback) {
            pos += chunk.length
            hasher?.update(chunk)
            callback(null)
          },
          final(callback) {
            const hash = hasher?.digest('base64')
            if (md5 != null && hash !== md5) {
              callback(
                Object.assign(new Error('Request Content-MD5 mismatch'), {
                  expected: md5,
                  actual: hash,
                }),
              )
            } else if (length != null && pos !== Number(length)) {
              callback(
                Object.assign(new Error('Request Content-Length mismatch'), {
                  expected: Number(length),
                  actual: pos,
                }),
              )
            } else {
              callback(null)
            }
          },
        }),
        () => {},
      ),
    }
  } else if (opts.body instanceof Buffer || typeof opts.body === 'string') {
    const buf = Buffer.from(opts.body)
    const hasher = md5 ? crypto.createHash('md5') : null

    const hash = hasher?.update(buf).digest('base64')
    const pos = buf.length

    if (md5 != null && hash !== md5) {
      throw Object.assign(new Error('Request Content-MD5 mismatch'), {
        expected: md5,
        actual: hash,
      })
    }

    if (length != null && pos !== Number(length)) {
      throw Object.assign(new Error('Request Content-Length mismatch'), {
        expected: Number(length),
        actual: pos,
      })
    }
  } else {
    assert(false, 'not implemented')
  }

  return dispatch(opts, new Handler(opts, { handler }))
}
