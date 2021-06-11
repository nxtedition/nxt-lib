const { monitorEventLoopDelay } = require('perf_hooks')
const { eventLoopUtilization } = require('perf_hooks').performance

function getSampleInterval(value, eventLoopResolution) {
  const defaultValue = monitorEventLoopDelay ? 1000 : 5
  const sampleInterval = value || defaultValue
  return monitorEventLoopDelay ? Math.max(eventLoopResolution, sampleInterval) : sampleInterval
}

function now() {
  const ts = process.hrtime()
  return ts[0] * 1e3 + ts[1] / 1e6
}

// Based on: https://github.com/fastify/under-pressure/blob/master/index.js
module.exports = function (opts, onStats) {
  const resolution = 10
  const sampleInterval = getSampleInterval(opts && opts.sampleInterval, resolution)

  let heapUsed = 0
  let rssBytes = 0
  let eventLoopDelay = 0
  let lastCheck
  let histogram
  let elu
  let eventLoopUtilized = 0

  if (monitorEventLoopDelay) {
    histogram = monitorEventLoopDelay({ resolution })
    histogram.enable()
  } else {
    lastCheck = now()
  }

  if (eventLoopUtilization) {
    elu = eventLoopUtilization()
  }

  const timer = setInterval(updateMemoryUsage, sampleInterval)
  timer.unref()

  function updateEventLoopDelay() {
    if (histogram) {
      eventLoopDelay = Math.max(0, histogram.mean / 1e6 - resolution)
      histogram.reset()
    } else {
      const toCheck = now()
      eventLoopDelay = Math.max(0, toCheck - lastCheck - sampleInterval)
      lastCheck = toCheck
    }
  }

  function updateEventLoopUtilization() {
    if (elu) {
      eventLoopUtilized = eventLoopUtilization(elu).utilization
    } else {
      eventLoopUtilized = 0
    }
  }

  function updateMemoryUsage() {
    const mem = process.memoryUsage()
    heapUsed = mem.heapUsed
    rssBytes = mem.rss
    updateEventLoopDelay()
    updateEventLoopUtilization()

    if (onStats) {
      onStats({
        eventLoopDelay,
        heapUsed,
        rssBytes,
        eventLoopUtilized,
      })
    }
  }

  return {
    get eventLoopDelay() {
      return eventLoopDelay
    },
    get heapUsed() {
      return heapUsed
    },
    get rssBytes() {
      return rssBytes
    },
    get eventLoopUtilized() {
      return eventLoopUtilized
    },
  }
}
