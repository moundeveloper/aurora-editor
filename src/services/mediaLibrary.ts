import {
  assetListSchema, importResultSchema, mediaUrl, vaultInfoSchema,
  type ImportResult, type MediaAssetRecord, type VaultInfo,
} from '#shared/contracts.ts'

/**
 * The app's side of the media server.
 *
 * Responses are parsed through the same schemas the server validates against, so a route changing
 * shape surfaces here rather than as an undefined three components away. Requests go to relative
 * paths, which Vite proxies in development and a packaged build serves from the same origin.
 */

export class MediaServerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'MediaServerError'
  }
}

async function failure(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null
  return new MediaServerError(body?.error ?? `${response.status} ${response.statusText}`, response.status)
}

export async function listAssets(signal?: AbortSignal): Promise<MediaAssetRecord[]> {
  const response = await fetch('/api/assets', { signal })
  if (!response.ok) throw await failure(response)
  return assetListSchema.parse(await response.json()).assets
}

export async function vaultInfo(signal?: AbortSignal): Promise<VaultInfo> {
  const response = await fetch('/api/assets/vault', { signal })
  if (!response.ok) throw await failure(response)
  return vaultInfoSchema.parse(await response.json())
}

/**
 * Uploads a file as a raw body rather than multipart, matching the server: the browser streams it
 * straight from disk, so importing a large clip never materialises it in memory.
 */
export async function importAsset(file: File, signal?: AbortSignal): Promise<ImportResult> {
  const query = new URLSearchParams({ name: file.name })
  if (file.type) query.set('mimeType', file.type)
  const response = await fetch(`/api/assets?${query}`, {
    method: 'POST',
    body: file,
    // Required by fetch whenever the body is a stream, and harmless for a File.
    duplex: 'half',
    signal,
  } as RequestInit & { duplex: 'half' })
  if (!response.ok) throw await failure(response)
  return importResultSchema.parse(await response.json())
}

export async function deleteAsset(id: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`/api/assets/${encodeURIComponent(id)}`, { method: 'DELETE', signal })
  if (!response.ok && response.status !== 404) throw await failure(response)
}

export async function serverAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    return (await fetch('/api/health', { signal })).ok
  } catch {
    return false
  }
}

export { mediaUrl }
export type { MediaAssetRecord }
