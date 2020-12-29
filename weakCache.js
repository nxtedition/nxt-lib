/* globals WeakRef FinalizationRegistry */

module.exports = function weakCache (valueSelector, keySelector) {
  const cache = new Map()
  const finalizationRegistry = new FinalizationRegistry(key => {
    const ref = cache.get(key)
    if (ref !== undefined && ref.deref() === undefined) {
      cache.delete(key)
    }
  })
  return (...args) => {
    const key = keySelector ? keySelector(...args) : args[0]
    const ref = cache.get(key)
    if (ref !== undefined) {
      const deref = ref.deref()
      if (deref !== undefined) {
        return deref
      }
    }
    const value = valueSelector(key)
    cache.set(key, new WeakRef(value))
    finalizationRegistry.register(value, key)
    return value
  }
}
