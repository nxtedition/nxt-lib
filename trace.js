import { Pool } from 'undici'
import fp from 'lodash/fp.js'

export function makeTrace({
  url,
  stringify = JSON.stringify,
  index,
  batch = 128e3,
  limit = 16e6,
  destroyers,
  logger,
  serviceName,
}) {
  const HEADERS = ['content-type', 'application/x-ndjson']

  let pending = 0

  const client = new Pool(Array.isArray(url) ? url[0] : url, {
    keepAliveTimeout: 10 * 60e3,
    pipelining: 4,
    connections: 4,
  })

  const flushInterval = setInterval(flushTraces, 10e3)

  destroyers?.push(async () => {
    clearInterval(flushInterval)
    while (traceData) {
      await flushTraces()
    }
    await client.close()
  })

  let traceData = ''
  async function flushTraces() {
    if (!traceData) {
      return
    }

    const data = traceData
    traceData = ''

    try {
      pending += data.length
      await client
        .request({
          throwOnError: true,
          path: '/_bulk',
          method: 'POST',
          idempotent: true,
          headers: HEADERS,
          headersTimeout: 2 * 60e3,
          body: data,
        })
        .then(({ body }) => body.dump())
    } catch (err) {
      logger.error({ err }, 'trace failed')
    } finally {
      pending -= data.length
    }
  }

  const warnDrop = fp.throttle(10e3, () => {
    logger.warn('trace dropped')
  })

  const prefix = `{ "create": { "_index": "trace-${index}" } }\n{ "serviceName": "${serviceName}", "op": "`

  function trace(obj, op) {
    if (obj.serviceName) {
      throw new Error('invalid property `serviceName`')
    }
    if (obj.op) {
      throw new Error('invalid property `op`')
    }

    if (obj['@timestamp']) {
      throw new Error('invalid property `@timestamp`')
    }

    if (pending > limit) {
      warnDrop()
    } else {
      const doc = (typeof obj === 'string' ? obj : stringify(obj)).slice(1, -1)
      traceData += prefix + `${op}", "@timestamp": ${Date.now()}, ${doc} }\n`
      if (traceData.length > batch) {
        flushTraces()
      }
    }
  }

  trace.stringify = stringify
  trace.trace = trace
  trace.write = trace
  trace.flush = flushTraces

  return trace
}
