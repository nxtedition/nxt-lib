const NestedError = require('nested-error-stacks')
const weakCache = require('../../weakCache')
const rxjs = require('rxjs')
const hasha = require('hasha')
const vm = require('node:vm')

const globals = {
  fp: require('lodash/fp'),
  moment: require('moment'),
}

const kWait = Symbol('kWait')

const hashaint = (value, _options = {}) => {
  const str = JSON.stringify(value)
  const hash = hasha(str, _options)
  return parseInt(hash.slice(-13), 16)
}

module.exports = ({ ds } = {}) => {
  return weakCache((expression) => {
    try {
      const script = new vm.Script(`"use strict"; ${expression}`)

      return (args) => {
        return new rxjs.Observable((o) => {
          const entries = new Map()

          let dirty = false

          const refresh = () => {
            if (!dirty) {
              dirty = true
              setImmediate(callScript)
            }
          }

          const getRecord = (recordId, path, state = ds.record.SERVER) => {
            let entry = entries.get(recordId)
            if (!entry) {
              entry = {
                isUsed: false,
                record: ds.record.getRecord(recordId),
                dispose () {
                  this.record.unref()
                  this.record.off('update', refresh)
                },
              }
              entry.record.on('update', refresh)
              entries.set(recordId, entry)
            }
            entry.isUsed = true

            if (typeof state === 'string') {
              state = ds.CONSTANTS.RECORD_STATE[state.toUpperCase()]
            }

            if (state == null) {
              state =
                recordId.startsWith('{') || recordId.includes('?')
                  ? ds.record.PROVIDER
                  : ds.record.SERVER
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

          const getTimer = (dueTime, undueValue, dueValue) => {
            dueTime = Number.isFinite(dueTime)
              ? dueTime
              : dueTime?.valueOf
                ? dueTime.valueOf()
                : 0
            const nowTime = Date.now()

            if (nowTime >= dueTime) {
              return dueValue
            }

            const delay = dueTime - nowTime

            let entry = entries.get(dueTime)
            if (!entry) {
              entry = {
                isUsed: false,
                timer: setTimeout(refresh, delay),
                dispose () {
                  clearTimeout(this.timer)
                  this.timer = null
                }
              }
              entries.set(dueTime, entry)
            }
            entry.isUsed = true

            return undueValue
          }

          const pipe = (value, ...funcs) => {
            for (const func of funcs) {
              value = func(value)
              if (value == null) {
                break
              }
            }
            return value
          }

          pipe.asset = (type) => (id) => hasAssetType(id, type, false)
          pipe.ds = (domain, path, state) => (id) => getRecord(id + domain, path, state)

          const context = vm.createContext({
            ...globals,
            $: args,
            nxt: {
              ...args,
              ds: getRecord,
              asset: hasAssetType,
              hashaint,
              timer: getTimer,
              _: pipe,
            },
          })

          const callScript = () => {
            dirty = false

            for (const entry of entries.values()) {
              entry.isUsed = false
            }

            try {
              o.next(script.runInContext(context))
            } catch (err) {
              if (err !== kWait) {
                o.error(err)
              }
            }

            for (const [key, entry] of entries.entries()) {
              if (!entry.isUsed) {
                entry.dispose()
                entries.delete(key)
              }
            }
          }

          callScript()

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
