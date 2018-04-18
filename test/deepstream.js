const { isSameOrNewer } = require('../src/deepstream')
const assert = require('assert')

/* global describe it */

// Note that subtract ranges expects merged ranges as input.

describe('isSameOrNewer', function () {
  it('INF is bigger than falsy', function () {
    assert(isSameOrNewer('INF-00000000000000', null))
    assert(!isSameOrNewer(null, 'INF-00000000000000'))
  })
  it('INF is bigger than non INF', function () {
    assert(isSameOrNewer('INF-00000000000000', '1-00000000000000'))
    assert(!isSameOrNewer('1-00000000000000', 'INF-00000000000000'))
  })
  it('INF is equal', function () {
    assert(isSameOrNewer('INF-00000000000000', 'INF-00000000000000'))
  })
})
