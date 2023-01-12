const { test } = require('tap')
const jsonPath = require('../json-path')

test('merge one level', (t) => {
  t.same(jsonPath.merge({ a: 1 }, null, { b: 2 }), { a: 1, b: 2 })

  t.end()
})
