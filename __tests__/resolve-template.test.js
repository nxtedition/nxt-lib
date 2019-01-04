const { resolveTemplate } = require('../src/util')
const Observable = require('rxjs')
const mapValues = require('lodash/mapValues')
const pickBy = require('lodash/pickBy')
require('jasmine-check').install(global)

const { check, gen } = global

test('replaces strings', async (done) => {
  expect(await resolveTemplate('{{test}}', { test: '111' })).toBe('111')
  expect(await resolveTemplate('pre{{test}}post', { test: '111' })).toBe('pre111post')
  expect(await resolveTemplate('123{{test}}456{{test}}{{test}}', { test: 'body' })).toBe('123body456bodybody')
  expect(await resolveTemplate('test{{test.foo}}test{{test.bar.baz}}test', { test: { foo: '111', bar: { baz: '222' } } })).toBe('test111test222test')
  done()
})

test('nested', async (done) => {
  expect(await resolveTemplate('{{{{foo}}}}', { test: '111', foo: 'test' })).toBe('111')
  done()
})

test('append', async (done) => {
  expect(await resolveTemplate(`{{test | append('1')}}`, { test: '111' })).toBe('1111')
  done()
})

test('ds', async (done) => {
  const ds = {
    record: {
      observe: () => Observable.of({ foo: 'bar' })
    }
  }
  expect(await resolveTemplate(`{{test | ds() | pluck('foo')}}`, { test: 'foo' }, { ds })).toBe('bar')
  done()
})

describe('map', async () => {
  await Promise.all([
    check.it(
      'treats empty call as noop',
      gen.object({ test: gen.array(gen.int) }),
      gen.int,
      (x, y) => {
        const { test } = x
        const t = `{{ test | map() }}`
        const e = JSON.stringify(test)
        const r = resolveTemplate(t, x)
        return expect(r).resolves.toBe(e)
      }
    ),
    check.it(
      'maps arrays',
      gen.object({ test: gen.array(gen.int) }),
      gen.int,
      (x, y) => {
        const { test } = x
        const t = `{{ test | map('mul', ${y}) }}`
        const e = JSON.stringify(test.map(x => x * y))
        const r = resolveTemplate(t, x)
        return expect(r).resolves.toBe(e)
      }
    ),
    check.it(
      'maps object values',
      gen.object({ test: gen.object(gen.string, gen.int) }),
      gen.int,
      (x, y) => {
        const { test } = x
        const t = `{{ test | map('mul', ${y}) }}`
        const e = JSON.stringify(mapValues(test, x => x * y))
        const r = resolveTemplate(t, x)
        return expect(r).resolves.toBe(e)
      }
    )
  ])
})

describe('select', async () => {
  await Promise.all([
    check.it(
      'treats empty call as Boolean filter',
      gen.object({ test: gen.array(gen.int) }),
      gen.int,
      (x, y) => {
        const { test } = x
        const t = `{{ test | select() }}`
        const e = JSON.stringify(test.filter(Boolean))
        const r = resolveTemplate(t, x)
        return expect(r).resolves.toBe(e)
      }
    ),
    check.it(
      'filters arrays',
      gen.object({ test: gen.array(gen.int) }),
      gen.int,
      (x, y) => {
        const { test } = x
        const t = `{{ test | select('gte', ${y}) }}`
        const e = JSON.stringify(test.filter(x => x >= y))
        const r = resolveTemplate(t, x)
        return expect(r).resolves.toBe(e)
      }
    ),
    check.it(
      'filters object entries',
      gen.object({ test: gen.object(gen.string, gen.int) }),
      gen.int,
      (x, y) => {
        const { test } = x
        const t = `{{ test | select('gte', ${y}) }}`
        const e = JSON.stringify(pickBy(test, x => x >= y))
        const r = resolveTemplate(t, x)
        return expect(r).resolves.toBe(e)
      }
    )
  ])
})
