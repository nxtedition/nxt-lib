const NestedError = require('nested-error-stacks')
const weakCache = require('../../weakCache')
const rxjs = require('rxjs')
const vm = require('node:vm')
const objectHash = require('object-hash')

const globals = {
  fp: require('lodash/fp'),
  moment: require('moment'),
}

const kWait = Symbol('kWait')
const maxInt = 2147483647

module.exports = ({ ds } = {}) => {
  return weakCache((expression) => {
    try {
      const script = new vm.Script(`"use strict"; ${expression}`)

      return (args) => {
        return new rxjs.Observable((o) => {
          const entries = new Map()

          let refreshing = false
          let counter = 0

          const refreshNT = () => {
            refreshing = false
            counter = (counter + 1) & maxInt

            try {
              o.next(script.runInContext(context))
            } catch (err) {
              if (err !== kWait) {
                o.error(err)
              }
            }

            for (const entry of entries.values()) {
              if (entry.counter !== counter) {
                entry.dispose()
                entries.delete(entry.key)
              }
            }
          }

          const refresh = () => {
            if (!refreshing) {
              refreshing = true
              queueMicrotask(refreshNT)
            }
          }

          const getRecord = (key, path, state = ds.record.SERVER) => {
            let entry = entries.get(key)
            if (!entry) {
              entry = {
                key,
                counter,
                record: ds.record.getRecord(key),
                dispose() {
                  this.record.unref()
                  this.record.off('update', refresh)
                  this.record = null
                },
              }
              entry.record.on('update', refresh)
              entries.set(key, entry)
            } else {
              entry.counter = counter
            }

            if (typeof state === 'string') {
              state = ds.CONSTANTS.RECORD_STATE[state.toUpperCase()]
            }

            if (state == null) {
              state =
                key.startsWith('{') || key.includes('?') ? ds.record.PROVIDER : ds.record.SERVER
            }

            if (entry.record.state < state) {
              throw kWait
            }

            return entry.record.get(path)
          }

          const hasAssetType = (id, type) => {
            const types = getRecord(id + ':asset.rawTypes?', 'value')
            return types.includes(type) ? id : null
          }

          const getTimer = (dueTime, dueValue = dueTime, undueValue = null) => {
            dueTime = Number.isFinite(dueTime) ? dueTime : new Date(dueTime).valueOf()

            const nowTime = Date.now()

            if (!Number.isFinite(dueTime)) {
              return undueValue
            }

            if (nowTime >= dueTime) {
              return dueValue
            }

            const key = objectHash({ dueTime, dueValue, undueValue })

            let entry = entries.get(dueTime)
            if (!entry) {
              entry = {
                key,
                counter,
                timer: setTimeout(refresh, dueTime - nowTime),
                dispose() {
                  clearTimeout(this.timer)
                  this.timer = null
                },
              }
              entries.set(key, entry)
            } else {
              entry.counter = counter
            }

            return undueValue
          }

          const context = vm.createContext({
            ...globals,
            $: args,
            nxt: {
              get: getRecord,
              asset: hasAssetType,
              hash: objectHash,
              timer: getTimer,
              _: Object.assign(
                (value, ...fns) => {
                  for (const fn of fns) {
                    value = fn(value)
                    if (value == null) {
                      return undefined
                    }
                  }
                  return value
                },
                {
                  asset: (type) => (id) => hasAssetType(id, type),
                  ds: (domain, path, state) => (id) => getRecord(`${id}:${domain}`, path, state),
                  timer: (dueTime) => (dueValue) => getTimer(dueTime, dueValue),
                }
              ),
            },
          })

          refreshNT()

          return () => {
            for (const entry of entries.values()) {
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
