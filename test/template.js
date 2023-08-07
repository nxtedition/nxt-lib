const { test } = require('tap')
const { resolveTemplate, compileTemplate } = require('../util/template/index.js')({})

test('noop', async (t) => {
  const x = { foo: 1, bar: {} }
  const y = await resolveTemplate(x)
  t.equal(x, y)
  t.end()
})

test('simple', async (t) => {
  const x = { bar: '{{#js $.test }}' }
  const y = await resolveTemplate(x, { test: 1 })
  t.same(y, { bar: 1 })
  t.end()
})

test('cache', async (t) => {
  const x = '{{#js $.test }}'
  t.equal(compileTemplate(x), compileTemplate(x))
  t.end()
})
