const assert = require('assert')
const tp = require('timers/promises')
const xuid = require('xuid')
const { isReadableNodeStream, readableStreamLength } = require('./stream')
const undici = require('undici')
const stream = require('stream')
const omitEmpty = require('omit-empty')

module.exports.request = async function request(
  url,
  {
    logger,
    id = xuid(),
    retry,
    maxRedirections: _maxRedirections,
    idempotent,
    redirect,
    dispatcher,
    signal,
    headersTimeout,
    bodyTimeout,
    reset = false,
    body,
    method = body ? 'POST' : 'GET',
    userAgent,
    headers,
  }
) {
  if (retry === false) {
    retry = { count: 0 }
  } else if (typeof retry === 'number') {
    retry = { count: retry }
  }

  if (redirect === false) {
    redirect = { count: 0 }
  } else if (typeof redirect === 'number') {
    redirect = { count: redirect }
  }

  const { count: maxRedirections = _maxRedirections ?? 3 } = redirect ?? {}
  const {
    count: maxRetries = 8,
    method: retryMethod = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE', 'PATCH'],
    status: retryStatus = [420, 429, 502, 503, 504],
    code: retryCode = [
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ENETDOWN',
      'ENETUNREACH',
      'EHOSTDOWN',
      'EHOSTUNREACH',
      'EPIPE',
    ],
    message: retryMessage = ['other side closed'],
  } = retry ?? {}

  if (readableStreamLength(body) === 0) {
    body.on('error', () => {})
    body = null
  }

  const ureq = {
    url,
    method,
    body,
    headers: omitEmpty({
      'request-id': id,
      'user-agent': userAgent,
      ...headers,
    }),
  }

  const upstreamLogger = logger?.child({ ureq })

  upstreamLogger?.debug({ ureq }, 'upstream request started')

  try {
    /* eslint-disable no-unreachable-loop */
    for (let retryCount = 0; true; retryCount++) {
      try {
        const ures = await undici.request(url, {
          method,
          reset,
          body,
          headers,
          signal,
          dispatcher,
          maxRedirections,
          throwOnError: true,
          headersTimeout,
          bodyTimeout,
        })

        upstreamLogger?.debug({ ureq, ures }, 'upstream request response')

        if (ures.statusCode >= 300 && ures.statusCode < 400) {
          await ures.body.dump()
          throw new Error('maxRedirections exceeded')
        }

        assert(ures.statusCode >= 200 && ures.statusCode < 300)

        // TODO (fix): Wrap response to handle error that can continue with range request...

        return ures
      } catch (err) {
        if (retryCount >= maxRetries) {
          throw err
        }

        if (
          body != null &&
          typeof body !== 'string' &&
          !Buffer.isBuffer(body) &&
          (!isReadableNodeStream(body) || stream.isDisturbed(body))
        ) {
          throw err
        }

        if (!retryMethod.includes(method) && !idempotent) {
          throw err
        }

        if (
          !retryCode.includes(err.code) &&
          !retryMessage.includes(err.message) &&
          !retryStatus.includes(err.statusCode)
        ) {
          throw err
        }

        const delay =
          parseInt(err.headers?.['Retry-After']) * 1e3 || Math.min(10e3, retryCount * 1e3 + 1e3)

        upstreamLogger?.warn({ err, retryCount, delay }, 'upstream request retrying')

        await tp.setTimeout(delay, undefined, { signal })
      }
    }
  } catch (err) {
    upstreamLogger?.error({ err }, 'upstream request failed')
    throw err
  }
}
