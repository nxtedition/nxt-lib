const NestedError = require('nested-error-stacks')
const weakCache = require('../../weakCache')
const rxjs = require('rxjs')
const _ = require('lodash')
const fp = require('lodash/fp')
const moment = require('lodash')

const overrides = [
  '__dirname',
  '__filename',
  'clearImmediate',
  'clearInterval',
  'clearTimeout',
  'console',
  'exports',
  'fetch',
  'global',
  'module',
  'process',
  'queueMicrotask',
  'require',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'WebAssembly',
]

const globals = { _, fp, moment }

const kEmpty = Symbol('kEmpty')

module.exports = ({ ds } = {}) => {
  return weakCache((expression) => {
    try {
      // eslint-disable-next-line no-new-func
      const script = new Function(
        ...overrides,
        ...Object.keys(globals),
        'ctx',
        'ds',
        `return ${expression.trim()}`
      )

      return (context) => {
        return new rxjs.Observable((o) => {
          const records = new Map()

          let dirty = false

          const refresh = () => {
            if (!dirty) {
              dirty = true
              setImmediate(callScript)
            }
          }

          const getRecord = (recordId, path, state = ds.record.SERVER) => {
            let entry = records.get(recordId)
            if (!entry) {
              entry = { isUsed: false, record: ds.record.getRecord(recordId) }
              entry.record.on('update', refresh)
              records.set(recordId, entry)
            }
            entry.isUsed = true

            if (typeof state === 'string') {
              // TODO (fix): Convert to state
            }

            if (entry.record.state < state) {
              throw kEmpty
            }

            return entry.record.get(path)
          }

          const callScript = () => {
            dirty = false

            for (const entry of records.values()) {
              entry.isUsed = false
            }

            try {
              // TODO (fix): https://nodejs.org/api/vm.html
              const result = script(
                ...new Array(overrides.length),
                ...Object.values(globals),
                context,
                getRecord
              )
              o.next(result)
            } catch (err) {
              if (err !== kEmpty) {
                o.error(err)
              }
            }

            for (const [recordId, entry] of records.entries()) {
              if (!entry.isUsed) {
                entry.record.unref()
                entry.record.off('update', refresh)
                records.delete(recordId)
              }
            }
          }

          callScript()

          return () => {
            for (const entry of records.values()) {
              entry.record.unref()
              entry.record.off('update', refresh)
            }
          }
        })
      }
    } catch (err) {
      throw new NestedError(`failed to parse expression ${expression}`, err)
    }
  })
}
