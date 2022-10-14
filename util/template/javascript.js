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

module.exports = ({ ds } = {}) => {
  function makeTimerEntry(key, refresh, delay) {
    return {
      key,
      timer: setTimeout(refresh, delay),
      dispose: disposeTimerEntry,
    }
  }

  function disposeTimerEntry() {
    clearTimeout(this.timer)
    this.timer = null
  }

  function makeRecordEntry(key, refresh) {
    const entry = {
      key,
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
      if (value == null) {
        return undefined
      }
    }
    return value
  }

  return weakCache((expression) => {
    let script
    try {
      script = new vm.Script(`"use strict"; ${expression}`)
    } catch (err) {
      throw new Error(`failed to parse expression ${expression}`, { cause: err })
    }

    return (args) =>
      new rxjs.Observable((o) => {
        const entries = []
        const context = vm.createContext({
          ...globals,
          $: args,
          nxt: {
            get: getRecord,
            asset: hasAssetType,
            hash: objectHash,
            timer: getTimer,
          },
          _: Object.assign((...args) => pipe(...args), {
            asset: (type) => (id) => hasAssetType(id, type),
            ds: (postfix, path, state) => (id) => getRecord(`${id}${postfix}`, path, state),
            timer: (dueTime) => (dueValue) => getTimer(dueTime, dueValue),
          }),
        })

        let refreshing = false
        let index = 0

        refreshNT()

        return () => {
          for (const entry of entries) {
            entry.dispose()
          }
          entries.length = 0
        }

        function refreshNT() {
          refreshing = false
          index = 0

          try {
            o.next(script.runInContext(context))
          } catch (err) {
            if (err !== kWait) {
              o.error(err)
            }
          }

          for (let n = index; n < entries.length; n++) {
            entries[n].dispose()
          }
          entries.length = index
        }

        function refresh() {
          if (!refreshing) {
            refreshing = true
            queueMicrotask(refreshNT)
          }
        }

        function getEntry(key, factory, opaque) {
          if (index === entries.length) {
            entries.push(factory(key, refresh, opaque))
          } else if (entries[index].key !== key) {
            entries[index].dispose()
            entries[index] = factory(key, refresh, opaque)
          }

          return entries[index++]
        }

        function getRecord(key, path, state) {
          if (typeof state === 'string') {
            state = ds.CONSTANTS.RECORD_STATE[state.toUpperCase()]
          }

          if (state == null) {
            state = key.startsWith('{') || key.includes('?') ? ds.record.PROVIDER : ds.record.SERVER
          }

          const entry = getEntry(key, makeRecordEntry)

          if (entry.record.state < state) {
            throw kWait
          }

          return entry.record.get(path)
        }

        function hasAssetType(id, type) {
          const types = getRecord(id + ':asset.rawTypes?', 'value')
          return types.includes(type) ? id : null
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
