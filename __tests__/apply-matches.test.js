const { applyMatches } = require('../src/util')

test('replaces strings', () => {
  expect(applyMatches('{{test}}', { test: 'asd' })).toBe('asd')
  expect(applyMatches('123{{test}}456', { test: 'asd' })).toBe('123asd456')
  expect(applyMatches('123{{test}}456{{test}}{{test}}', { test: 'asd' })).toBe('123asd456asdasd')
  expect(applyMatches('123{{{{tmp}}}}456{{test}}{{test}}', { test: 'asd', tmp: 'test' })).toBe('123asd456asdasd')
  expect(applyMatches('{{test.foo}}', { test: { foo: 'asd' } })).toBe('asd')
  expect(applyMatches('{{test.foo2}}', { test: { foo: 'asd' } })).toBe(undefined)
  expect(applyMatches('`{{test.foo2}}`', { test: { foo: 'asd' } })).toBe('')

  const obj = { asd: 'foo' }
  expect(applyMatches('{{test.foo}}', { test: { foo: obj } })).toBe(obj)
  expect(applyMatches('{{test.foo}}{{test.foo}}', { test: { foo: obj } })).toBe(undefined)
  expect(applyMatches('{{{{test.foo}}}}', { test: { foo: obj } })).toBe(undefined)
  expect(applyMatches('{{{{test.foo}}}}{{test.foo}}', { test: { foo: obj } })).toBe(undefined)
})
