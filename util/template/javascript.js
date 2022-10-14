const weakCache = require('../../weakCache')
const rxjs = require('rxjs')
const vm = require('node:vm')
const objectHash = require('object-hash')
const datefns = require('date-fns')
const JSON5 = require('json5')

const globals = {
  fp: require('lodash/fp'),
  moment: require('moment-timezone'),
  datefns,
  JSON5,
}

const kWait = Symbol('kWait')
const kEmpty = Symbol('kEmpty')
const maxInt = 2147483647

function makeTimerEntry(key, refresh, delay) {
  return {
    key,
    counter: null,
    timer: setTimeout(refresh, delay),
    dispose: disposeTimerEntry,
  }
}

function disposeTimerEntry() {
  clearTimeout(this.timer)
  this.timer = null
}

function makeRecordEntry(key, refresh, ds) {
  const entry = {
    key,
    counter: null,
    refresh,
    record: ds.record.getRecord(key),
    dispose: disposeRecordEntry,
  }
  entry.record.on('update', refresh)
  return entry
}

function disposeRecordEntry() {
  this.record.unref()
  this.record.off('update', this.refresh)
  this.record = null
}

function pipe(value, ...fns) {
  for (const fn of fns) {
    value = fn(value)
    if (value === kWait) {
      return undefined
    }
    if (value == null) {
      return null
    }
  }
  return value
}

module.exports = ({ ds } = {}) => {
  return weakCache((expression) => {
    let script
    try {
      script = new vm.Script(`"use strict"; ${expression}`)
    } catch (err) {
      throw new Error(`failed to parse expression ${expression}`, { cause: err })
    }

    return (args) =>
      new rxjs.Observable((o) => {
        // TODO (perf): This could be faster by using an array + indices.
        // A bit similar to how react-hooks works.
        const _entries = new Map()
        const _context = vm.createContext({
          ...globals,
          $: args,
          nxt: {
            get: (id, state) => getRecord(id, state, true),
            asset: (id, type) => getHasRawAssetType(id, type, true),
            hash: objectHash,
            timer: getTimer,
          },
          _: Object.assign((...args) => pipe(...args), {
            asset: (type) => (id) => getHasRawAssetType(id, type, false),
            ds: (postfix, state) => (id) => getRecord(`${id}${postfix}`, state, false),
            timer: (dueTime) => (dueValue) => getTimer(dueTime, dueValue),
          }),
        })

        let _refreshing = false
        let _counter = 0
        let _value = kEmpty

        refreshNT()

        return () => {
          for (const entry of _entries.values()) {
            entry.dispose()
          }
        }

        function refreshNT() {
          _refreshing = false
          _counter = (_counter + 1) & maxInt

          try {
            const value = script.runInContext(_context)
            if (value !== _value && value !== kWait) {
              _value = value
              o.next(value)
            }
          } catch (err) {
            if (err !== kWait) {
              o.error(
                Object.assign(new Error('expression failed'), {
                  cause: err,
                  data: { expression, args },
                })
              )
            }
          }

          for (const entry of _entries.values()) {
            if (entry.counter !== _counter) {
              entry.dispose()
              _entries.delete(entry.key)
            }
          }
        }

        function refresh() {
          if (!_refreshing) {
            _refreshing = true
            queueMicrotask(refreshNT)
          }
        }

        function getEntry(key, factory, opaque) {
          let entry = _entries.get(key)
          if (!entry) {
            entry = factory(key, refresh, opaque)
            _entries.set(key, entry)
          }
          entry.counter = _counter
          return entry
        }

        function getRecord(key, state, throws = true) {
          if (state == null) {
            state = key.startsWith('{') || key.includes('?') ? ds.record.PROVIDER : ds.record.SERVER
          } else if (typeof state === 'string') {
            state = ds.CONSTANTS.RECORD_STATE[state.toUpperCase()]
            if (state == null) {
              throw new Error(`invalid argument: state (${state})`)
            }
          }

          const entry = getEntry(key, makeRecordEntry, ds)

          if (entry.record.state < state) {
            if (throws) {
              throw kWait
            } else {
              return kWait
            }
          }

          return entry.record.data
        }

        function getHasRawAssetType(id, type, throws) {
          const data = getRecord(id + ':asset.rawTypes?', ds.record.PROVIDER, throws)
          return data === kWait ? kWait : data.value.includes(type) ? id : null
        }

        function getTimer(dueTime, dueValue = dueTime, undueValue = null) {
          dueTime = Number.isFinite(dueTime) ? dueTime : new Date(dueTime).valueOf()

          const nowTime = Date.now()

          if (!Number.isFinite(dueTime)) {
            return undueValue
          }

          if (nowTime >= dueTime) {
            return dueValue
          }

          getEntry(objectHash({ dueTime, dueValue, undueValue }), makeTimerEntry, dueTime - nowTime)

          return undueValue
        }
      })
  })
}
