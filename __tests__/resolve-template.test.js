const { resolveTemplate } = require('../src/util')
const ds = {
  record: {
    get: Promise.resolve({ value: 'test' })
  }
}

test('replaces strings', async () => {
  expect(await resolveTemplate('{{test}}', { test: '111' }, { ds })).toBe('111')
  expect(await resolveTemplate('pre{{test}}post', { test: '111' }, { ds })).toBe('pre111post')
  expect(await resolveTemplate('123{{test}}456{{test}}{{test}}', { test: 'body' }, { ds })).toBe('123body456bodybody')
  expect(await resolveTemplate('test{{test.foo}}test{{test.bar.baz}}test', { test: { foo: '111', bar: { baz: '222' } } }, { ds })).toBe('test111test222test')
})
