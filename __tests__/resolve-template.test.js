const { resolveTemplate } = require('../src/util')
const Observable = require('rxjs')

test('replaces strings', async () => {
  expect(await resolveTemplate('{{test}}', { test: '111' })).toBe('111')
  expect(await resolveTemplate('pre{{test}}post', { test: '111' })).toBe('pre111post')
  expect(await resolveTemplate('123{{test}}456{{test}}{{test}}', { test: 'body' })).toBe('123body456bodybody')
  expect(await resolveTemplate('test{{test.foo}}test{{test.bar.baz}}test', { test: { foo: '111', bar: { baz: '222' } } })).toBe('test111test222test')
})

test('nested', async () => {
  expect(await resolveTemplate('{{{{foo}}}}', { test: '111', foo: 'test' })).toBe('111')
  expect(await resolveTemplate('{{ asd | default("{{test}}")}}', { test: '111', foo: 'test' })).toBe('111')
})

test('append', async () => {
  expect(await resolveTemplate(`{{test | append('1')}}`, { test: '111' })).toBe('1111')
})

test('object', async () => {
  let obj = { foo: 1 }
  expect(await resolveTemplate(`{{test}}`, { test: obj })).toBe(obj)
})

test('ds', async () => {
  const ds = {
    record: {
      observe: () => Observable.of({ foo: 'bar' })
    }
  }
  expect(await resolveTemplate(`{{test | ds() | pluck('foo')}}`, { test: 'foo' }, { ds })).toBe('bar')
})

describe('map', () => {
  test('treats empty call as noop', async () => {
    expect(await resolveTemplate(`{{ test | map() }}`, { test: [] })).toMatchObject([])
    expect(await resolveTemplate(`{{ test | map() }}`, { test: [ 1 ] })).toMatchObject([ 1 ])
  })
  test('maps arrays', async () => {
    expect(await resolveTemplate(`{{ test | map('mul', 2) }}`, { test: [ 1 ] })).toMatchObject([ 2 ])
  })
  test('maps objects', async () => {
    expect(await resolveTemplate(`{{ test | map('mul', 2) }}`, { test: { a: 1 } })).toMatchObject({ a: 2 })
  })
})

describe('select', () => {
  test('treats empty call as Boolean filter', async () => {
    expect(await resolveTemplate(`{{ test | select() }}`, { test: [ 1 ] })).toMatchObject([ 1 ])
  })
  test('filters arrays', async () => {
    expect(await resolveTemplate(`{{ test | select('ge', 2) }}`, { test: [ 1, 2 ] })).toMatchObject([ 2 ])
  })
  test('filters objects', async () => {
    expect(await resolveTemplate(`{{ test | select('ge', 2) }}`, { test: { a: 1, b: 2 } })).toMatchObject({ b: 2 })
  })
})
