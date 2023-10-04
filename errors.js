const objectHash = require('object-hash')
const fp = require('lodash/fp.js')
const { toString } = Object.prototype
const { SIGNALS } = require('./platform.js')

module.exports.AbortError = class AbortError extends Error {
  constructor(message) {
    super(message ?? 'The operation was aborted')
    this.code = 'ABORT_ERR'
    this.name = 'AbortError'
  }
}

module.exports.parseError = function parseError(error) {
  if (!error) {
    return null
  }

  if (typeof error === 'string') {
    error = { message: error }
  }

  if (Array.isArray(error)) {
    error = error.map(parseError).filter(Boolean)
    if (error.length === 1) {
      error = error.length === 1 ? error[0] : { errors: error }
    }
  }

  const { msg, message = msg, errors, cause, data, ...properties } = error
  return Object.assign(
    Array.isArray(errors)
      ? new AggregateError(errors.map(parseError), message)
      : new Error(message || 'unknown error'),
    {
      ...properties,
      cause: cause ? parseError(error.cause) : undefined,
    },
  )
}

const kSeen = Symbol('kSeen')

module.exports.serializeError = function serializeError(error) {
  if (!error) {
    return null
  }

  if (typeof error === 'string') {
    return serializeError({ message: error })
  }

  if (Array.isArray(error)) {
    const errors = error.map(serializeError).filter(Boolean)
    return errors.length === 0 ? null : errors.length === 1 ? errors[0] : errors
  }

  if (Object.prototype.hasOwnProperty.call(error, kSeen)) {
    return null
  }

  error[kSeen] = undefined

  const type =
    toString.call(error.constructor) === '[object Function]' ? error.constructor.name : error.name

  let data = error.data || error.body
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      // Do nothing...
    }
  }

  let {
    msg,
    message = msg,
    errors,
    code,
    signal,
    cause,
    body,
    statusCode,
    status = statusCode,
    headers,
    ...properties
  } = error

  if (typeof signal === 'number') {
    signal = SIGNALS[signal] ?? signal
  }

  errors = Array.isArray(errors) ? errors.map(serializeError) : undefined
  cause = cause ? serializeError(cause) : undefined

  delete error[kSeen]

  return JSON.parse(
    JSON.stringify({
      ...properties,
      message,
      type,
      code,
      signal,
      status,
      headers,
      data,
      cause,
      errors,
    }),
  )
}

// TODO (fix): Recursion guard?
module.exports.makeMessages = function makeMessages(error, options) {
  if (!error) {
    return []
  }

  if (Array.isArray(error)) {
    return fp.pipe(
      fp.flattenDeep,
      fp.flatMap((x) => makeMessages(x, null)),
      fp.uniqBy('id'),
    )(error)
  } else if (Array.isArray(error.messages)) {
    return makeMessages(error.messages, null)
  } else if (error) {
    let err
    if (typeof error === 'string' && error) {
      err = { msg: error, id: options?.id, level: options?.level || 50, code: options?.code }
    } else if (typeof error === 'object') {
      const level = parseInt(error.level) || options?.level || 50
      const code =
        [error?.code, options?.codes?.[error?.code]].find(
          (x) => typeof x === 'string' && x.length > 0,
        ) ?? undefined
      const msg =
        [error.msg, error.message, code?.toLowerCase().replace('_', ' ')].find(
          (x) => typeof x === 'string' && x.length > 0,
        ) || 'unknown error'

      let data = error.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {}
      }

      err = {
        msg,
        title: error.title ?? error.name,
        id: error.id ?? options?.id ?? objectHash({ msg, level, code, data: error.data }),
        level,
        code,
        data,
        index:
          error.index === null || error.index === false
            ? null
            : typeof error.index === 'object'
            ? error.index
            : error.index === undefined || error.index === true
            ? options?.index === true
              ? { message: msg }
              : null
            : null,
      }
    } else {
      err = {
        msg: 'Unknown Error',
        titlte: 'UnknownError',
        id: 'unknown_error',
        level: 50,
        code: 'NXT_UNKNOWN_ERROR',
        data: error,
      }
    }

    return [
      err,
      ...makeMessages([
        error.cause,
        error.error,
        error.errors,
        error.messages,
        error.status?.messages,
      ]),
    ]
  } else {
    return []
  }
}

module.exports.makeErrorString = function makeErrorString(err) {
  err = module.exports.parseError(err)

  let msg = err?.message || 'error'

  if (err?.cause) {
    msg += `caused by: ${module.exports.makeErrorString(err.cause)}`
  }

  if (Array.isArray(err?.errors)) {
    msg += ': ' + err.errors.map((err) => module.exports.makeErrorString(err)).join(', ')
  }

  return msg
}
