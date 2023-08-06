const { test } = require('tap')
const { resolveTemplate } = require('../util/template/index.js')({})

test('noop', async (t) => {
  const x = { foo: 1, bar: {} }
  const y = await resolveTemplate(x)
  t.equal(x, y)
  t.end()
})
