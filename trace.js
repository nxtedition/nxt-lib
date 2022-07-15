const { Pool } = require('undici')

module.exports = function ({
  url,
  stringify = JSON.stringify,
  index,
  destroyers,
  logger,
  serviceName,
}) {
  const HEADERS = ['content-type', 'application/x-ndjson']

  const client = new Pool(Array.isArray(url) ? url[0] : url, {
    keepAliveTimeout: 10 * 60e3,
    pipelining: 8,
    connections: 1,
  })

  destroyers?.push(() => client.close())

  let prefix = ''
  function updatePrefix() {
    prefix = ''
  }

  let traceData = ''
  async function flushTraces() {
    if (!traceData) {
      return
    }

    try {
      const requestBody = traceData
      traceData = ''

      const { body } = await client.request({
        throwOnError: true,
        path: '/_bulk',
        method: 'POST',
        idempotent: true,
        headers: HEADERS,
        body: requestBody,
      })
      await body.dump()
    } catch (err) {
      logger.error({ err }, 'trace failed')
    }
  }

  setInterval(updatePrefix, 1e3).unref()
  setInterval(flushTraces, 30e3).unref()

  return function trace(obj, op) {
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
    const doc = stringify(obj).slice(1, -1)
    traceData += prefix + `${op}", ${doc} }\n`
    if (traceData.length > 128 * 1024) {
      flushTraces()
    }
  }
}
