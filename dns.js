const dns = require('dns/promises')
const net = require('net')
const LRU = require('lru-cache')

const cache = new LRU({ maxAge: 10e3, max: 1024 })

async function _resolve({ hostname, timeout, maxAge, servers, cached }) {
  let addresses = cached !== false ? cache.get(hostname) : null

  if (!addresses) {
    const resolver = new dns.Resolver({ timeout: timeout ?? 2e3 })
    if (servers) {
      resolver.setServers(servers)
    }
    addresses = await resolver.resolve(hostname)
    cache.set(hostname, addresses, maxAge)
  }

  return addresses
}

const map = new Map()

async function resolve({ hostname, logger, maxAge, cached }, callback) {
  if (callback) {
    resolve({ hostname, logger, maxAge, cached })
      .then((val) => callback(null, val))
      .catch((err) => callback(err))
    return
  }

  if (net.isIP(hostname)) {
    return []
  }

  let addresses
  let type

  if (!addresses && /[a-zA-Z-0-9]\.nxt\.lan/.test(hostname)) {
    try {
      hostname = hostname.replace('.nxt.lan', '')

      let servers = map.get('tasks.dns')
      try {
        servers = await _resolve('tasks.dns')
        map.set('tasks.dns', servers)
      } catch (err) {
        logger?.warn({ err }, 'failed to lookup tasks.dns')
      }

      if (servers.length === 0) {
        throw new Error('no entries for tasks.dns')
      }

      addresses = await _resolve({ hostname: `${hostname}.nxt.lan`, servers, maxAge, cached })
      type = 'nxt'
    } catch (err) {
      logger?.warn({ err }, `failed to lookup ${hostname} through tasks.dns`)
    }
  }

  if (!addresses) {
    try {
      addresses = await _resolve({ hostname, maxAge, cached })
      type = 'docker'
    } catch (err) {
      logger?.warn({ err }, `failed to lookup ${hostname}`)
    }
  }

  if (!addresses) {
    addresses = map.get(hostname) ?? []
    type = 'fallback'
  }

  logger?.debug({ type, addresses }, 'lookup')

  map.set(hostname, addresses)

  return addresses
}

module.exports = {
  resolve,
}
