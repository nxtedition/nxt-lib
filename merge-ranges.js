const mergeRangesImpl = require('merge-ranges')

module.exports = function mergeRanges (a) {
  return mergeRangesImpl(JSON.parse(JSON.stringify(a)))
    .filter(([ start, end ]) => end > start)
}
