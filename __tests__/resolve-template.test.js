const { resolveTemplate } = require('../src/util/template')({
  ds: {
    record: {
      observe: () => Observable.of({ foo: 'bar' })
    }
  }
})
const Observable = require('rxjs')

test('hash to int', async () => {
  const val = await resolveTemplate('{{test | hashaint() | mod(128)}}', { test: { foo: '11d1' } })
  expect(Number.isFinite(val)).toBe(true)
})

test('baseValue', async () => {
  expect(await resolveTemplate('{{test}}', { test: '11d1' })).toBe('11d1')
  expect(await resolveTemplate('{{test}}', { test: Observable.of('11d1') })).toBe('11d1')
  expect(await resolveTemplate('{{test.asd}}', { test: Observable.of({ asd: '11d1' }) })).toBe('11d1')
  expect(await resolveTemplate('{{test.asd}}', { test: { asd: Observable.of('11d1') } })).toBe('11d1')
})

test('integer ops', async () => {
  expect(await resolveTemplate('{{test | div(2)}}', { test: '8' })).toBe(4)
  expect(await resolveTemplate('{{test | div(2)}}', { test: 8 })).toBe(4)
  expect(await resolveTemplate('{{test | mul(2)}}', { test: '8' })).toBe(16)
  expect(await resolveTemplate('{{test | mul(2)}}', { test: 8 })).toBe(16)
  expect(await resolveTemplate('{{test | add(2)}}', { test: '10' })).toBe(12)
  expect(await resolveTemplate('{{test | add(2)}}', { test: 10 })).toBe(12)
  expect(await resolveTemplate('{{test | sub(2)}}', { test: '10' })).toBe(8)
  expect(await resolveTemplate('{{test | sub(2)}}', { test: 10 })).toBe(8)
})

test('path var', async () => {
  expect(await resolveTemplate('{{test.foo}}', { test: { foo: '111' } })).toBe('111')
})

test('replaces strings', async () => {
  expect(await resolveTemplate('{{test}}', { test: '111' })).toBe('111')
  expect(await resolveTemplate('pre{{test}}post', { test: '111' })).toBe('pre111post')
  expect(await resolveTemplate('123{{test}}456{{test}}{{test}}', { test: 'body' })).toBe('123body456bodybody')
  expect(await resolveTemplate('test{{test.foo}}test{{test.bar.baz}}test', { test: { foo: '111', bar: { baz: '222' } } })).toBe('test111test222test')
  expect(await resolveTemplate('{{ asd | default("te | st")}}', {})).toBe('te | st')
  expect(await resolveTemplate('{{ asd | default("test\n") }}', {})).toBe('test\n')
  expect(await resolveTemplate('{{ asd | default("test\n\n") }}', {})).toBe('test\n\n')
  expect(await resolveTemplate('{{ asd | default("test\r\n") }}', {})).toBe('test\r\n')
})

test('nested', async () => {
  expect(await resolveTemplate('{{ asd | default("{{foo}}") }}', { foo: '"test"' })).toBe('"test"')
  expect(await resolveTemplate('{{{{foo}}}}', { test: '111', foo: 'test' })).toBe('111')
  expect(await resolveTemplate('f{{oo}}', { test: '111', foo: 'test', oo: 'oo' })).toBe('foo')
  expect(await resolveTemplate('{{f{{oo}}}}', { test: '111', foo: 'test', oo: 'oo' })).toBe('test')
  expect(await resolveTemplate('{{{{foo}}}}', { test: '111', foo: 'test' })).toBe('111')
  expect(await resolveTemplate('{{{{f{{o}}o}}}}', { test: '111', foo: 'test', o: 'o' })).toBe('111')
  expect(await resolveTemplate('{{ asd | default("{{test}}")}}', { test: '111', foo: 'test' })).toBe('111')
  expect(await resolveTemplate('{{ asd | default("{{t{{es}}t}}")}}', { test: '111', foo: 'test', es: 'es' })).toBe('111')
  expect(await resolveTemplate('{{ asd | default("{{test | default("test\n")}}")}}', {})).toBe('test\n')
  expect(await resolveTemplate('{{ asd | default("{{test | default("test\n\n")}}")}}', {})).toBe('test\n\n')
  expect(await resolveTemplate('{{ asd | default("{{test | default("test\r\n")}}")}}', {})).toBe('test\r\n')
})

test('append', async () => {
  expect(await resolveTemplate('{{test | append(\'1\')}}', { test: '111' })).toBe('1111')
})

test('object', async () => {
  const obj = { foo: 1 }
  expect(await resolveTemplate('{{test}}', { test: obj })).toBe(obj)
})

test('ds', async () => {
  expect(await resolveTemplate('{{test | ds() | pluck(\'foo\')}}', { test: 'foo' })).toBe('bar')
})

test('replace array', async () => {
  expect(await resolveTemplate('{{test | join("#") | replace("foo", "bar") | split("#")}}', { test: ['foo', 'bar'] })).toEqual(['bar', 'bar'])
  expect(await resolveTemplate('{{test | join(",") | replace("foo", "bar") | split(",")}}', { test: ['foo', 'bar'] })).toEqual(['bar', 'bar'])
})

test('You Do Not Know Me', async () => {
  expect(await resolveTemplate('{{id | default("You Do Not Know", true)}} -', {})).toBe('You Do Not Know -')
})
