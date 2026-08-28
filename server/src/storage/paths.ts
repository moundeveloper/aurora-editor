import { homedir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'

/**
 * The vault is the one directory Aurora owns on disk. Everything the server reads or writes has to
 * resolve inside it — the server is bound to loopback, but a path built from a request is still a
 * path built from input, and `..` is cheap to defend against.
 */
export interface VaultLayout {
  root: string
  media: string
  cache: string
  projects: string
  temp: string
  database: string
}

export function vaultLayout(root = process.env.AURORA_VAULT ?? join(homedir(), 'Aurora')): VaultLayout {
  const absolute = resolve(root)
  return {
    root: absolute,
    media: join(absolute, 'media'),
    cache: join(absolute, 'cache'),
    projects: join(absolute, 'projects'),
    temp: join(absolute, '.tmp'),
    database: join(absolute, 'aurora.db'),
  }
}

export async function ensureVault(layout: VaultLayout) {
  await Promise.all([
    mkdir(layout.media, { recursive: true }),
    mkdir(join(layout.cache, 'proxies'), { recursive: true }),
    mkdir(join(layout.cache, 'thumbs'), { recursive: true }),
    mkdir(join(layout.cache, 'waveforms'), { recursive: true }),
    mkdir(layout.projects, { recursive: true }),
    mkdir(layout.temp, { recursive: true }),
  ])
  return layout
}

/** A 64-character lowercase hex digest, and nothing else, may address a blob. */
export function isContentHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

/**
 * Blobs are sharded by the first byte of their hash. A single directory holding every file in a
 * media library degrades badly on most filesystems, and 256 buckets is enough to keep it flat.
 */
export function blobPath(layout: VaultLayout, hash: string): string {
  if (!isContentHash(hash)) throw new Error(`refusing to build a path from a non-hash: ${hash}`)
  return join(layout.media, hash.slice(0, 2), hash)
}

/**
 * Confirms a path really is inside a directory, after both have been resolved. Compared with a
 * trailing separator so `/vault-backup` cannot pass as being inside `/vault`.
 */
export function isInside(directory: string, candidate: string): boolean {
  const parent = resolve(directory)
  const child = resolve(candidate)
  if (child === parent) return true
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/** Resolves a caller-supplied relative path against a root, refusing anything that escapes it. */
export function safeJoin(root: string, relative: string): string {
  if (isAbsolute(relative)) throw new Error('absolute paths are not accepted')
  const joined = resolve(root, relative)
  if (!isInside(root, joined)) throw new Error('path escapes the vault')
  return joined
}
