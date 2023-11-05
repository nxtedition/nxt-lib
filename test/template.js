const { test } = require('tap')
const { resolveTemplate } = require('../util/template/index.js')({})

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

// test('cache', async (t) => {
//   const x = '{{#js $.test }}'
//   t.equal(compileTemplate(x), compileTemplate(x))
//   t.end()
// })

test('string concat', async (t) => {
  const x = '{{#js $.pre }} {{#js $.body}} {{#js $.post}}'
  t.equal(await resolveTemplate(x, { pre: 'pre', body: 'body', post: 'post' }), 'pre body post')
  t.end()
})
