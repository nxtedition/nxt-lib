const NestedError = require('nested-error-stacks')
const weakCache = require('../../weakCache')
const rxjs = require('rxjs')
const hasha = require('hasha')
const vm = require('node:vm')
const babel = require('@babel/core')

const babelOptions = {
  plugins: [
    [
      '@babel/plugin-proposal-pipeline-operator',
      {
        proposal: 'hack',
        topicToken: '#',
      },
    ],
  ],
}

const globals = {
  _: require('lodash'),
  fp: require('lodash/fp'),
  moment: require('moment'),
}

const kWait = Symbol('kWait')
const kNull = Symbol('kNull')

const hashaint = (value, _options = {}) => {
  const str = JSON.stringify(value)
  const hash = hasha(str, _options)
  return parseInt(hash.slice(-13), 16)
}

module.exports = ({ ds } = {}) => {
  return weakCache((expression) => {
    try {
      const transformed = babel.transformSync(`"use strict"; ${expression}`, babelOptions)
      const script = new vm.Script(transformed.code)

      return (args) => {
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

          const hasAssetType = (id, type, throws = true) => {
            const types = getRecord(id + ':asset.rawTypes?', 'value')
            if (types.includes(type)) {
              return id
            }
            if (throws) {
              throw kNull
            }
            return null
          }

          const context = vm.createContext({
            ...globals,
            ...args,
            nxt: {
              ds: getRecord,
              asset: hasAssetType,
              hashaint,
              // timer, // TODO
            },
          })

          const callScript = () => {
            dirty = false

            for (const entry of records.values()) {
              entry.isUsed = false
            }

            try {
              o.next(script.runInContext(context))
            } catch (err) {
              if (err === kNull) {
                o.next(null)
              } else if (err !== kWait) {
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
