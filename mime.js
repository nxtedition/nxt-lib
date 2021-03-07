const mime = require('mime')

function lookup(name) {
  if (!name) {
    return null
  }
  if (/\.nut$/.test(name)) {
    return 'video/x-nut'
  }
  if (/\.dnxhd$/.test(name)) {
    return 'video/x-dnxhd'
  }
  if (/\.dv$/.test(name)) {
    return 'video/x-dv'
  }
  if (/\.pcm-s32le/.test(name)) {
    return 'audio/x-pcm-s32le'
  }
  if (/\.pcm-s24le/.test(name)) {
    return 'audio/x-pcm-s24le'
  }
  if (/\.pcm-s16le/.test(name)) {
    return 'audio/x-pcm-s16le'
  }
  // NOTE: Workaround for Chrome. See, https://bugs.chromium.org/p/chromium/issues/detail?id=227004.
  if (/\.mp3$/.test(name)) {
    return 'audio/mp3'
  }
  return mime.getType(name)
}

function extension(type) {
  if (!type) {
    return null
  }
  if (/video\/(x-)?nut/.test(type)) {
    return 'nut'
  }
  if (/video\/(x-)?dnxhd/.test(type)) {
    return 'dnxhd'
  }
  if (/audio\/(x-)?pcm-s32le/.test(type)) {
    return 'pcm-s32le'
  }
  if (/audio\/(x-)?pcm-s24le/.test(type)) {
    return 'pcm-s24le'
  }
  if (/audio\/(x-)?pcm-s16le/.test(type)) {
    return 'pcm-s16le'
  }
  return mime.getExtension(type) || (type || '').split('/').pop()
}

module.exports = {
  extension,
  getExtension: extension,
  lookup,
  getType: lookup,
}
