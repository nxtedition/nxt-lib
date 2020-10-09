const subtractRanges = require('../subtract-ranges')
const mergeRanges = require('../merge-ranges')
const assert = require('assert')

describe('subtractRanges', function () {
  test('should return the positive ranges if nothing is subtracted', function () {
    const positive = mergeRanges([
      [10, 20],
      [30, 40]
    ])

    const negative = mergeRanges([])

    const expected = positive

    const difference = subtractRanges(positive, negative)
    assert.deepStrictEqual(difference, expected)
  })

  test('should remove ranges that are completely covered', function () {
    const positive = mergeRanges([
      [10, 20],
      [30, 40],
      [50, 60]
    ])

    const negative = mergeRanges([
      [10, 45]
    ])

    const expected = mergeRanges([
      [50, 60]
    ])

    const difference = subtractRanges(positive, negative)
    assert.deepStrictEqual(difference, expected)
  })

  test('should be empty if fully covered', function () {
    const positive = mergeRanges([
      [831513792, 1024000000]
    ])

    const negative = mergeRanges([
      [0, 1024000000]
    ])

    const expected = mergeRanges([

    ])

    const difference = subtractRanges(positive, negative)
    assert.deepStrictEqual(difference, expected)
  })

  test('should treat range-ends as non-inclusive', function () {
    const positive = mergeRanges([
      [10, 20],
      [30, 40],
      [50, 60]
    ])

    const negative = mergeRanges([
      [20, 30],
      [40, 50]
    ])

    const expected = positive

    const difference = subtractRanges(positive, negative)
    assert.deepStrictEqual(difference, expected)
  })

  test('should remove parts of ranges that are partially covered', function () {
    const positive = mergeRanges([
      [10, 20],
      [30, 40],
      [50, 60]
    ])

    const negative = mergeRanges([
      [15, 35],
      [35, 40],
      [50, 55]
    ])

    const expected = mergeRanges([
      [10, 15],
      [55, 60]
    ])

    const difference = subtractRanges(positive, negative)
    assert.deepStrictEqual(difference, expected)
  })

  test('should split ranges in two, if only their center is covered', function () {
    const positive = mergeRanges([
      [10, 20],
      [30, 40],
      [50, 60]
    ])

    const negative = mergeRanges([
      [11, 12],
      [31, 32],
      [33, 34],
      [51, 52],
      [53, 54],
      [54, 60]
    ])

    const expected = mergeRanges([
      [10, 11],
      [12, 20],
      [30, 31],
      [32, 33],
      [34, 40],
      [50, 51],
      [52, 53]
    ])

    const difference = subtractRanges(positive, negative)
    assert.deepStrictEqual(difference, expected)
  })

  test('should not modify the original arrays', function () {
    const positive = mergeRanges([
      [10, 20],
      [30, 40],
      [50, 60]
    ])

    const negative = mergeRanges([
      [11, 12],
      [31, 32],
      [33, 34],
      [51, 52],
      [53, 54],
      [54, 60]
    ])

    const positiveCopy = positive.slice(0)
    const negativeCopy = negative.slice(0)

    const difference = subtractRanges(positive, negative)
    assert.ok(difference !== positive)
    assert.ok(difference !== negative)
    assert.deepStrictEqual(positive, positiveCopy)
    assert.deepStrictEqual(negative, negativeCopy)
  })
})
