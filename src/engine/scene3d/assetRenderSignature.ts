import type { MediaAsset } from '@/models/editor'

/** Published geometry is immutable. Watch its revision metadata, never its vertex arrays. */
export function assetRenderSignature(assets: readonly MediaAsset[]) {
  return JSON.stringify(assets.map(asset=>[
    asset.id,asset.kind,asset.hash,asset.dimensions,asset.thumbnail,
    asset.nativeModel?.revisions.map(revision=>revision.revision),
  ]))
}
