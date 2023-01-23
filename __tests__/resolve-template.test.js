const { test } = require('node:test')
const assert = require('node:assert')

const { resolveTemplate } = require('../util/template')({
  ds: {
    record: {
      observe: () => Observable.of({ foo: 'bar' }),
    },
  },
})
const Observable = require('rxjs')

test('hash to int', async () => {
  const val = await resolveTemplate('{{test | hashaint() | mod(128)}}', { test: { foo: '11d1' } })
  assert.strictEqual(Number.isFinite(val), true)
})

test('baseValue', async () => {
  assert.strictEqual(await resolveTemplate('{{test}}', { test: '11d1' }), '11d1')
  assert.strictEqual(await resolveTemplate('{{test}}', { test: Observable.of('11d1') }), '11d1')
  assert.strictEqual(
    await resolveTemplate('{{test.asd}}', { test: Observable.of({ asd: '11d1' }) }),
    '11d1'
  )
  assert.strictEqual(
    await resolveTemplate('{{test.asd}}', { test: { asd: Observable.of('11d1') } }),
    '11d1'
  )
})

test('integer ops', async () => {
  assert.strictEqual(await resolveTemplate('{{test | div(2)}}', { test: '8' }), 4)
  assert.strictEqual(await resolveTemplate('{{test | div(2)}}', { test: 8 }), 4)
  assert.strictEqual(await resolveTemplate('{{test | mul(2)}}', { test: '8' }), 16)
  assert.strictEqual(await resolveTemplate('{{test | mul(2)}}', { test: 8 }), 16)
  assert.strictEqual(await resolveTemplate('{{test | add(2)}}', { test: '10' }), 12)
  assert.strictEqual(await resolveTemplate('{{test | add(2)}}', { test: 10 }), 12)
  assert.strictEqual(await resolveTemplate('{{test | sub(2)}}', { test: '10' }), 8)
  assert.strictEqual(await resolveTemplate('{{test | sub(2)}}', { test: 10 }), 8)
})

test('null undefined args', async () => {
  assert.strictEqual(await resolveTemplate('{{asd | default(null, true)}}', {}), null)
  assert.strictEqual(await resolveTemplate('{{asd | default(undefined, true)}}', {}), undefined)
})

test('path var', async () => {
  assert.strictEqual(await resolveTemplate('{{test.foo}}', { test: { foo: '111' } }), '111')
})

test('replaces strings', async () => {
  assert.strictEqual(await resolveTemplate('{{test}}', { test: '111' }), '111')
  assert.strictEqual(await resolveTemplate('pre{{test}}post', { test: '111' }), 'pre111post')
  assert.strictEqual(
    await resolveTemplate('123{{test}}456{{test}}{{test}}', { test: 'body' }),
    '123body456bodybody'
  )
  assert.strictEqual(
    await resolveTemplate('test{{test.foo}}test{{test.bar.baz}}test', {
      test: { foo: '111', bar: { baz: '222' } },
    }),
    'test111test222test'
  )
  assert.strictEqual(await resolveTemplate('{{ asd | default("te | st")}}', {}), 'te | st')
  assert.strictEqual(await resolveTemplate('{{ asd | default("test\n") }}', {}), 'test\n')
  assert.strictEqual(await resolveTemplate('{{ asd | default("test\n\n") }}', {}), 'test\n\n')
  assert.strictEqual(await resolveTemplate('{{ asd | default("test\r\n") }}', {}), 'test\r\n')
})

test('nested', async () => {
  assert.strictEqual(
    await resolveTemplate('{{ asd | default("{{foo}}") }}', { foo: '"test"' }),
    '"test"'
  )
  assert.strictEqual(await resolveTemplate('{{{{foo}}}}', { test: '111', foo: 'test' }), '111')
  assert.strictEqual(
    await resolveTemplate('f{{oo}}', { test: '111', foo: 'test', oo: 'oo' }),
    'foo'
  )
  assert.strictEqual(
    await resolveTemplate('{{f{{oo}}}}', { test: '111', foo: 'test', oo: 'oo' }),
    'test'
  )
  assert.strictEqual(await resolveTemplate('{{{{foo}}}}', { test: '111', foo: 'test' }), '111')
  assert.strictEqual(
    await resolveTemplate('{{{{f{{o}}o}}}}', { test: '111', foo: 'test', o: 'o' }),
    '111'
  )
  assert.strictEqual(
    await resolveTemplate('{{ asd | default("{{test}}")}}', { test: '111', foo: 'test' }),
    '111'
  )
  assert.strictEqual(
    await resolveTemplate('{{ asd | default("{{t{{es}}t}}")}}', {
      test: '111',
      foo: 'test',
      es: 'es',
    }),
    '111'
  )
  assert.strictEqual(
    await resolveTemplate('{{ asd | default("{{test | default("test\n")}}")}}', {}),
    'test\n'
  )
  assert.strictEqual(
    await resolveTemplate('{{ asd | default("{{test | default("test\n\n")}}")}}', {}),
    'test\n\n'
  )
  assert.strictEqual(
    await resolveTemplate('{{ asd | default("{{test | default("test\r\n")}}")}}', {}),
    'test\r\n'
  )
})

test('append', async () => {
  assert.strictEqual(await resolveTemplate("{{test | append('1')}}", { test: '111' }), '1111')
})

test('object', async () => {
  const obj = { foo: 1 }
  assert.strictEqual(await resolveTemplate('{{test}}', { test: obj }), obj)
})

test('ds', async () => {
  assert.strictEqual(
    await resolveTemplate("{{test | ds() | pluck('foo')}}", { test: 'foo' }),
    'bar'
  )
})

test('replace array', async () => {
  assert.deepStrictEqual(
    await resolveTemplate('{{test | join("#") | replace("foo", "bar") | split("#")}}', {
      test: ['foo', 'bar'],
    }),
    ['bar', 'bar']
  )
  assert.deepStrictEqual(
    await resolveTemplate('{{test | join(",") | replace("foo", "bar") | split(",")}}', {
      test: ['foo', 'bar'],
    }),
    ['bar', 'bar']
  )
})

test('You Do Not Know Me', async () => {
  assert.deepStrictEqual(
    await resolveTemplate('{{id | default("You Do Not Know", true)}} -', {}),
    'You Do Not Know -'
  )
})

test('object 1', async () => {
  assert.deepStrictEqual(await resolveTemplate({ asd: ['{{foo}}'] }, { foo: 'bar' }), {
    asd: ['bar'],
  })
})

test('empty arg', async () => {
  assert.deepStrictEqual(
    await resolveTemplate('{{source.value | includes("salami") | ternary([], )}}', {}),
    undefined
  )
})
