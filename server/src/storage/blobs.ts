import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { blobPath, type VaultLayout } from './paths.ts'

export interface StoredBlob {
  hash: string
  sizeBytes: number
  /** False when an identical blob was already stored, so the upload was discarded. */
  written: boolean
}

/**
 * Streams bytes into the vault, hashing them on the way past.
 *
 * The stream is written to a temporary file first because the final name is not known until the last
 * byte has been hashed. Renaming into place afterwards is atomic within a filesystem, so a blob is
 * either absent or complete — an interrupted import cannot leave a truncated file behind that a later
 * request would happily serve as if it were whole.
 */
export async function storeBlob(layout: VaultLayout, source: AsyncIterable<Uint8Array> | NodeJS.ReadableStream): Promise<StoredBlob> {
  const temporary = join(layout.temp, `import-${randomUUID()}`)
  const digest = createHash('sha256')
  let sizeBytes = 0

  const measure = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      digest.update(chunk)
      sizeBytes += chunk.byteLength
      callback(null, chunk)
    },
  })

  try {
    await pipeline(source, measure, createWriteStream(temporary))
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }

  const hash = digest.digest('hex')
  const destination = blobPath(layout, hash)
  if (await exists(destination)) {
    await rm(temporary, { force: true })
    return { hash, sizeBytes, written: false }
  }

  await mkdir(dirname(destination), { recursive: true })
  try {
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return { hash, sizeBytes, written: true }
}

export async function blobStats(layout: VaultLayout, hash: string) {
  try {
    return await stat(blobPath(layout, hash))
  } catch {
    return null
  }
}

export async function removeBlob(layout: VaultLayout, hash: string) {
  await rm(blobPath(layout, hash), { force: true })
}

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
