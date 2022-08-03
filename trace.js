const { Pool } = require('undici')

const BATCH = 128e3
const LIMIT = 8e6

module.exports = function ({
  url,
  stringify = JSON.stringify,
  index,
  destroyers,
  logger,
  serviceName,
}) {
  const HEADERS = ['content-type', 'application/x-ndjson']

  let bytes = 0
  let dropped = 0

  const client = new Pool(Array.isArray(url) ? url[0] : url, {
    keepAliveTimeout: 10 * 60e3,
    pipelining: 4,
    connections: 4,
  })

  destroyers?.push(() => client.close())

  let prefix = ''
  function clearPrefix() {
    prefix = ''
  }

  let traceData = ''
  async function flushTraces() {
    if (!traceData) {
      return
    }

    const data = traceData
    traceData = ''

    if (bytes > LIMIT) {
      dropped += 1
      return
    }

    try {
      bytes += data.length * 2
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
      bytes -= data.length * 2
      if (bytes < LIMIT && dropped) {
        logger.error({ count: dropped }, 'trace dropped')
        dropped = 0
      }
    }
  }

  setInterval(clearPrefix, 1e3).unref()
  setInterval(flushTraces, 30e3).unref()

  function trace(obj, op) {
    if (obj.worker) {
      throw new Error('invalid property `worker`')
    }
    if (obj.op) {
      throw new Error('invalid property `op`')
    }

    if (obj['@timestamp']) {
      throw new Error('invalid property `@timestamp`')
    }

    if (!prefix) {
      prefix = `{ "create": { "_index": "${index}" } }\n{ "@timestamp": "${new Date().toISOString()}", "worker": "${serviceName}", "op": "`
    }

    const doc = (typeof obj === 'string' ? obj : stringify(obj)).slice(1, -1)

    traceData += prefix + `${op}", ${doc} }\n`
    if (traceData.length > BATCH) {
      flushTraces()
    }
  }

  trace.stringify = stringify
  trace.trace = trace
  trace.write = trace

  return trace
}
