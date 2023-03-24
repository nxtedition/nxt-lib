const objectHash = require('object-hash')
const fp = require('lodash/fp.js')

module.exports.AbortError = class AbortError extends Error {
  constructor() {
    super('The operation was aborted')
    this.code = 'ABORT_ERR'
    this.name = 'AbortError'
  }
}

module.exports.parseError = function parseError(error) {
  if (typeof error === 'string') {
    error = { message: error }
  }

  if (Array.isArray(error)) {
    error = error.map(parseError).filter(Boolean)
    if (error.length === 1) {
      error = error.length === 1 ? error[0] : { errors: error }
    }
  }

  if (fp.isEmpty(error)) {
    return null
  }

  const { msg, message = msg, errors, cause, data, ...properties } = error
  return Object.assign(
    Array.isArray(errors)
      ? new AggregateError(errors.map(parseError), message)
      : new Error(message || 'unknown error'),
    {
      ...properties,
      data: typeof data === 'string' ? data : JSON.stringify(data),
      cause: cause ? parseError(error.cause) : undefined,
    }
  )
}

module.exports.serializeError = function serializeError(error) {
  if (fp.isEmpty(error)) {
    return null
  }

  if (typeof error === 'string') {
    return serializeError({ message: error })
  }

  if (Array.isArray(error)) {
    const errors = error.map(serializeError).filter(Boolean)
    return errors.length === 0 ? null : errors.length === 1 ? errors[0] : errors
  }

  let {
    msg,
    message = msg,
    errors,
    code,
    cause,
    body,
    statusCode,
    status = statusCode,
    headers,
    data = body,
    ...properties
  } = error

  errors = Array.isArray(errors) ? errors.map(serializeError) : undefined
  cause = cause ? serializeError(cause) : undefined

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {}
  }

  return JSON.parse(
    JSON.stringify({
      ...properties,
      message,
      code,
      status,
      headers,
      data,
      cause,
      errors,
    })
  )
}

module.exports.makeMessages = function makeMessages(error, options) {
  if (!error) {
    return []
  } else if (Array.isArray(error)) {
    return fp.pipe(fp.flattenDeep, fp.filter(Boolean), makeMessages, fp.uniqBy('id'))(error)
  } else if (Array.isArray(error.messages)) {
    return makeMessages(error.messages)
  } else if (error) {
    let err
    if (typeof error === 'string' && error) {
      err = { msg: error, id: options?.id, level: options?.level || 40, code: options?.code }
    } else if (typeof error === 'object') {
      const level = parseInt(error.level) || options?.level || 40
      const code =
        [error?.code, options?.codes?.[error?.code]].find(
          (x) => typeof x === 'string' && x.length > 0
        ) ?? undefined
      const msg =
        [error.msg, error.message, code?.toLowerCase().replace('_', ' ')].find(
          (x) => typeof x === 'string' && x.length > 0
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
        index: typeof error.index === 'object' ? error.index : null,
      }
    }

    return makeMessages([
      err,
      error.cause,
      error.error,
      error.errors,
      error.messages,
      error.status?.messages,
    ])
  } else {
    return []
  }
}
