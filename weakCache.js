/* globals WeakRef FinalizationRegistry */

export function makeWeakCache(valueSelector, keySelector) {
  const cache = new Map()
  const finalizationRegistry = new FinalizationRegistry((key) => {
    const ref = cache.get(key)
    if (ref !== undefined && ref.deref() === undefined) {
      cache.delete(key)
    }
  })
  return (...args) => {
    const key = keySelector ? keySelector(...args) : args[0]
    const ref = cache.get(key)
    if (ref != null) {
      const deref = ref.deref()
      if (deref != null) {
        return deref
      }
    }
    const value = valueSelector(...args)
    if (value != null) {
      cache.set(key, new WeakRef(value))
      finalizationRegistry.register(value, key)
    }
    return value
  }
}
