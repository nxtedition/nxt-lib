import mime from 'mime'

export function lookup(name) {
  if (typeof name !== 'string' || name.length === 0) {
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

export function extension(mimeType, fileName) {
  if (typeof mimeType !== 'string' || mimeType.length === 0) {
    return null
  }
  if (/video\/(x-)?nut/.test(mimeType)) {
    return 'nut'
  }
  if (/video\/(x-)?dnxhd/.test(mimeType)) {
    return 'dnxhd'
  }
  if (/audio\/(x-)?pcm-s32le/.test(mimeType)) {
    return 'pcm-s32le'
  }
  if (/audio\/(x-)?pcm-s24le/.test(mimeType)) {
    return 'pcm-s24le'
  }
  if (/audio\/(x-)?pcm-s16le/.test(mimeType)) {
    return 'pcm-s16le'
  }

  const extension = mime.getExtension(mimeType) || (mimeType || '').split('/').pop()

  if (extension === 'qt' && typeof fileName === 'string' && fileName.endsWith('.mov')) {
    return 'mov'
  }

  return extension
}
