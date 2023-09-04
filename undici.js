import * as undici from 'undici'
import xuid from 'xuid'

export async function request(url, { logger, ...options }) {
  const ureq = {
    url,
    maxRedirections: 3,
    headers: {
      'req-id': xuid(),
      'user-agent': options.userAgent,
      ...options.headers,
    },
    ...options,
    throwOnError: true,
  }

  logger?.debug({ ureq }, 'upstream request started')

  const ures = await undici.request(url, options)

  logger?.debug({ ureq, ures }, 'upstream request response')

  if (ures.statusCode >= 300 && ures.statusCode < 400) {
    await ures.body.dump()
    throw new Error('maxRedirections exceeded')
  }

  return ures
}
