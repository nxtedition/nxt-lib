const Elasticsearch = require('@elastic/elasticsearch')
const { UndiciConnection } = require('@elastic/transport')

// https://github.com/elastic/elasticsearch-js/issues/1716#issuecomment-1167173492
class Connection extends UndiciConnection {
  request(params, options) {
    if (!options.signal) {
      const ac = new AbortController()
      options = {
        ...options,
        signal: ac.signal,
      }
    }
    return super.request(params, options)
  }
}

// Use ClusterConnectionPool until https://github.com/elastic/elasticsearch-js/issues/1714 is addressed.
// See, https://github.com/elastic/kibana/pull/134628
const ConnectionPool = Elasticsearch.ClusterConnectionPool

module.exports = function makeElasticsearchClient(config) {
  config = config?.elasticsearch ?? config
  return new Elasticsearch.Client({
    node: config.url,
    Connection,
    ConnectionPool,
    ...config,
  })
}