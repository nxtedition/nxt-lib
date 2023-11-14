import Elasticsearch from '@elastic/elasticsearch'
import { UndiciConnection } from '@elastic/transport'

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

export default function makeElasticsearchClient(config) {
  config = config?.elasticsearch ?? config
  if (typeof config === 'string') {
    config = { url: config }
  }
  return new Elasticsearch.Client({
    node: config.url,
    Connection,
    ConnectionPool,
    ...config,
  })
}
