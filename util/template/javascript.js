const NestedError = require('nested-error-stacks')
const weakCache = require('../../weakCache')
const rxjs = require('rxjs')
const rx = require('rxjs/operators')
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
          const activeRecords = new Map()
          const unusedRecordIds = new Set()

          const getRecord = (recordId) => {
            unusedRecordIds.delete(recordId)

            let entry = activeRecords.get(recordId)
            if (entry) {
              return entry.value
            }

            entry = { value: undefined }
            entry.subscription = ds.record
              .observe(recordId)
              .pipe(rx.distinctUntilChanged(fp.isEqual))
              .subscribe((x) => {
                entry.value = x
                callScript()
              })

            activeRecords.set(recordId, entry)
            return entry.value
          }

          let done = false

          const callScript = _.debounce(() => {
            if (done) {
              return
            }

            for (const recordId of activeRecords.keys()) {
              unusedRecordIds.add(recordId)
            }

            let result
            let error
            try {
              result = script(
                ...new Array(overrides.length),
                ...Object.values(globals),
                context,
                getRecord
              )
            } catch (err) {
              error = err
            }

            if (error) {
              o.error(error)
            } else {
              o.next(result)
            }

            for (const recordId of unusedRecordIds.values()) {
              const { subscription } = activeRecords.get(recordId)
              subscription.unsubscribe()
              activeRecords.delete(recordId)
            }
            unusedRecordIds.clear()
          }, 100)

          callScript()

          return () => {
            done = true
            for (const { subscription } of activeRecords.values()) {
              subscription.unsubscribe()
            }
            activeRecords.clear()
          }
        })
      }
    } catch (err) {
      throw new NestedError(`failed to parse expression ${expression}`, err)
    }
  })
}
