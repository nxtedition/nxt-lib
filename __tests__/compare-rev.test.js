const { compareRev } = require('../src/util')

test('compare-rev', () => {
  expect(compareRev(null, '1-00000000000000')).toBe(-1)
  expect(compareRev('1-00000000000000', null)).toBe(1)
  expect(compareRev(null, null)).toBe(0)
  expect(compareRev('1-00000000000000', '1-00000000000000')).toBe(0)
  expect(compareRev('INF-00000000000000', '1-00000000000000')).toBe(1)
  expect(compareRev('1-00000000000000', 'INF-00000000000000')).toBe(-1)
  expect(compareRev('INF-00000000000000', 'INF-00000000000000')).toBe(0)
  expect(compareRev('INF-00000000000001', 'INF-00000000000000')).toBe(1)
  expect(compareRev('INF-00000000000001', 'INF-00000000000002')).toBe(-1)
})
