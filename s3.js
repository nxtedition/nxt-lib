import crypto from 'node:crypto'
import stream from 'node:stream'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import AWS from '@aws-sdk/client-s3'

const CONTENT_MD5_EXPR = /^[A-F0-9]{32}$/i
const CONTENT_LENGTH_EXPR = /^\d+$/i

const noop = (arg0) => {}

class UploadPart {
  #partNumber
  #writable
  #callback
  #hasher
  #size

  constructor(dir, partNumber) {
    this.#partNumber = partNumber
    this.#writable = fs
      .createWriteStream(path.join(dir, `${this.#partNumber}.part`))
      .on('drain', () => {
        this.#callback()
        this.#callback = noop
      })
      .on('error', (err) => {
        this.#callback(err)
        this.callback = noop
      })
    this.#callback = noop
    this.#hasher = crypto.createHash('md5')
    this.#size = 0
  }

  get size() {
    return this.#size
  }

  write(chunk) {
    this.#size += chunk.byteLength
    this.#hasher.update(chunk)
    if (!this.#writable.write(chunk)) {
      return new Promise((resolve, reject) => {
        this.callback = (err) => (err ? reject(err) : resolve(null))
      })
    }
  }

  async end() {
    this.#writable.end()

    await stream.promises.finished(this.#writable)

    return {
      ContentMD5: this.#hasher.digest('base64'),
      ContentLength: this.#writable.bytesWritten,
      PartNumber: this.#partNumber,
      Body: fs.createReadStream(this.#writable.path),
    }
  }

  async destroy(err) {
    this.#writable.destroy(err)
    return stream.promises.finished(this.#writable)
  }
}

export async function upload({ client: s3 }, { Body, Key, Bucket, ContentMD5, ContentLength }) {
  if (ContentMD5 != null && !CONTENT_MD5_EXPR.test(ContentMD5)) {
    throw new Error(`Invalid ContentMD5: ${ContentMD5}`)
  }
  if (ContentLength != null && !CONTENT_LENGTH_EXPR.test(ContentLength)) {
    throw new Error(`Invalid ContentLength: ${ContentLength}`)
  }

  const multipartUploadOutput = await s3.send(
    new AWS.CreateMultipartUploadCommand({
      Bucket,
      Key,
    }),
  )
  const uploadId = multipartUploadOutput.UploadId

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 's3-upload-'))

  let part = new UploadPart(dir, 0)
  try {
    const uploader = {
      size: 0,
      hasher: crypto.createHash('md5'),
    }

    const flush = async () => {
      const { ContentMD5, ContentLength, PartNumber, Body } = await part.end()

      const partNumber = promises.length + 1
      promises.push(
        s3
          .send(
            new AWS.UploadPartCommand({
              Bucket,
              Key,
              UploadId: uploadId,
              ContentMD5,
              ContentLength,
              PartNumber,
              Body,
            }),
          )
          .then(
            ({ ETag }) => ({ part: { ETag, PartNumber: partNumber } }),
            (err) => ({ error: err }),
          )
          .finally(() => (Body.path ? fs.promises.unlink(Body.path) : null)),
      )

      part = new UploadPart(dir, partNumber)
    }

    const promises = []
    for await (const chunk of Body) {
      uploader.hasher.update(chunk)
      uploader.size += chunk.byteLength

      const promise = part.write(chunk)
      if (promise) {
        await promise
      }

      if (part && part.size > 64e6) {
        await flush()
      }
    }
    await flush()

    const parts = []
    for (const { part, error } of await Promise.all(promises)) {
      if (error) {
        throw error
      } else {
        parts.push(part)
      }
    }

    const uploadOutput = await s3.send(
      new AWS.CompleteMultipartUploadCommand({
        Bucket,
        Key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    )

    const result = {
      size: uploader.size,
      hash: uploader.hasher.digest('hex'),
      output: uploadOutput,
    }

    const size = ContentLength != null ? Number(ContentLength) : null
    const hash = ContentMD5

    if (size != null && size !== result.size) {
      throw new Error(`Expected size ${size} but got ${result.size}`)
    }

    if (hash != null && hash !== result.hash) {
      throw new Error(`Expected hash ${hash} but got ${result.hash}`)
    }

    return result
  } catch (err) {
    await part?.destroy(err)

    if (uploadId) {
      await s3.send(
        new AWS.AbortMultipartUploadCommand({
          Bucket,
          Key,
          UploadId: uploadId,
        }),
      )
    }
    throw err
  } finally {
    await fs.promises.rmdir(dir, { recursive: true })
  }
}
