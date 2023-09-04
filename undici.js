import * as undici from 'undici'
import assert from 'node:assert'
import xuid from 'xuid'
import tp from 'node:timers/promises'
import stream from 'node:stream'
import { isReadableNodeStream } from './stream.js'

export async function request(
  url,
  {
    logger,
    id = xuid(),
    retry: { count: maxRetries = 8 } = {},
    redirect: { count: maxRedirections = 3 } = {},
    dispatcher,
    signal,
    method = 'GET',
    body,
    userAgent,
    headers,
  }
) {
  const ureq = {
    url,
    method,
    body,
    headers: {
      'req-id': id,
      'user-agent': userAgent,
      ...headers,
    },
  }

  const upstreamLogger = logger?.child({ ureq })

  upstreamLogger?.debug({ ureq }, 'upstream request started')

  try {
    /* eslint-disable no-unreachable-loop */
    for (let retryCount = 0; true; retryCount++) {
      try {
        const ures = await undici.request(url, {
          method,
          body,
          headers,
          signal,
          dispatcher,
          maxRedirections,
          throwOnError: true,
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

        if (method === 'HEAD' || method === 'GET') {
          if (
            err.code !== 'ECONNRESET' &&
            err.code !== 'ECONNREFUSED' &&
            err.code !== 'ENOTFOUND' &&
            err.code !== 'ENETDOWN' &&
            err.code !== 'ENETUNREACH' &&
            err.code !== 'EHOSTDOWN' &&
            err.code !== 'EHOSTUNREACH' &&
            err.code !== 'EPIPE' &&
            err.message !== 'other side closed' &&
            err.statusCode !== 420 &&
            err.statusCode !== 429 &&
            err.statusCode !== 502 &&
            err.statusCode !== 503 &&
            err.statusCode !== 504
          ) {
            throw err
          }
        } else {
          // TODO (fix): What to do?
          throw err
        }

        const delay =
          parseInt(err.headers?.['Retry-After']) * 1e3 || Math.min(10e3, retryCount * 1e3 + 1e3)

        logger?.warn({ err, retryCount, delay }, 'upstream request retrying')

        return tp.setTimeout(delay, undefined, { signal })
      }
    }
  } catch (err) {
    logger?.error({ err }, 'upstream request failed')
    throw err
  }
}
