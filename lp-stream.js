// The MIT License (MIT)

// Copyright (c) 2014 Mathias Buus

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// Based on https://github.com/mafintosh/length-prefixed-stream

const stream = require('stream')
const varint = require('varint')

module.exports.Decoder = class Decoder extends stream.Transform {
  constructor(opts) {
    super({ objectMode: true })

    this._destroyed = false
    this._missing = 0
    this._message = null
    this._limit = (opts && opts.limit) || 0
    this._allowEmpty = !!(opts && opts.allowEmpty)
    this._prefix = Buffer.allocUnsafe(this._limit ? varint.encodingLength(this._limit) : 100)
    this._ptr = 0
  }

  _push(message) {
    this._ptr = 0
    this._missing = 0
    this._message = null
    this.push(message)
  }

  _parseLength(data, offset) {
    for (offset; offset < data.length; offset++) {
      if (this._ptr >= this._prefix.length) {
        return this._prefixError(data)
      }
      this._prefix[this._ptr++] = data[offset]
      if (!(data[offset] & 0x80)) {
        this._missing = varint.decode(this._prefix)
        if (this._limit && this._missing > this._limit) {
          return this._prefixError(data)
        }
        if (!this._missing && this._allowEmpty) {
          this._push(Buffer.alloc(0))
        }
        this._ptr = 0
        return offset + 1
      }
    }
    return data.length
  }

  _prefixError(data) {
    this.destroy(new Error('Message is larger than max length'))
    return data.length
  }

  _parseMessage(data, offset) {
    const free = data.length - offset
    const missing = this._missing

    if (!this._message) {
      if (missing <= free) {
        // fast track - no copy
        this._push(data.slice(offset, offset + missing))
        return offset + missing
      }
      this._message = Buffer.allocUnsafe(missing)
    }

    // TODO: add opt-in "partial mode" to completely avoid copys
    data.copy(this._message, this._ptr, offset, offset + missing)

    if (missing <= free) {
      this._push(this._message)
      return offset + missing
    }

    this._missing -= free
    this._ptr += free

    return data.length
  }

  _transform(data, enc, cb) {
    let offset = 0

    while (!this._destroyed && offset < data.length) {
      if (this._missing) {
        offset = this._parseMessage(data, offset)
      } else {
        offset = this._parseLength(data, offset)
      }
    }

    cb()
  }
}
