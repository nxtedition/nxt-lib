import { describe, test } from 'node:test'
import assert from 'node:assert'
import { mergeRanges } from '../merge-ranges.js'

// Note that subtract ranges expects merged ranges as input.

describe('mergeRanges', function () {
  test('should merge ranges', function () {
    assert.deepStrictEqual(
      mergeRanges([
        [10, 20],
        [20, 40],
      ]),
      [[10, 40]],
    )
    assert.deepStrictEqual(
      mergeRanges([
        [20, 40],
        [10, 20],
      ]),
      [[10, 40]],
    )
    assert.deepStrictEqual(
      mergeRanges([
        [20, 40],
        [100, 20],
        [10, 20],
      ]),
      [[10, 40]],
    )
    assert.deepStrictEqual(
      mergeRanges([
        [20, 40],
        [100, 120],
        [10, 20],
      ]),
      [
        [10, 40],
        [100, 120],
      ],
    )
  })
})
