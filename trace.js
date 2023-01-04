const { Pool } = require('undici')

function sleep(n) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n)
}

module.exports = function ({
  url,
  stringify = JSON.stringify,
  index,
  batch = 128e3,
  limit = 32e6,
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

  destroyers?.push(() => client.close())

  let traceData = ''
  async function flushTraces() {
    if (!traceData) {
      return
    }

    const data = traceData
    traceData = ''

    if (pending > limit / 4) {
      logger.warn('throttling')
      if (pending > limit) {
        sleep(1000)
      } else if (pending > limit / 2) {
        sleep(100)
      } else {
        sleep(10)
      }
    }

    try {
      pending += data.length
      await client
        .request({
          throwOnError: true,
          path: '/_bulk',
          method: 'POST',
          idempotent: true,
          headers: HEADERS,
          body: data,
        })
        .then(({ body }) => body.dump())
    } catch (err) {
      logger.error({ err }, 'trace failed')
    } finally {
      pending -= data.length
    }
  }

  setInterval(flushTraces, 10e3).unref()

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

    const doc = (typeof obj === 'string' ? obj : stringify(obj)).slice(1, -1)

    traceData += prefix + `${op}", "@timestamp": ${Date.now()}, ${doc} }\n`
    if (traceData.length > batch) {
      flushTraces()
    }
  }

  trace.stringify = stringify
  trace.trace = trace
  trace.write = trace
  trace.flush = flushTraces

  return trace
}
