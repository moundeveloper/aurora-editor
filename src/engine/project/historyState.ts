import { toRaw } from 'vue'
import type { ModelDraft } from '../../../shared/modeling'
import type { SerializedEditorState } from '@/models/editor'
import { serializableEditorState, serializeEditorState } from './serialization'

/** Copy-on-change JSON tree. Live mutable objects are never retained in snapshots. */
function shareTree(value: unknown, previous: unknown): unknown {
  if (!value || typeof value !== 'object') return typeof value === 'number' && !Number.isFinite(value) ? null : value
  value = toRaw(value)
  if (value === previous && Object.isFrozen(value)) return value
  if (Array.isArray(value)) {
    const old = Array.isArray(previous) ? previous : []
    let copy: unknown[] | null = Array.isArray(previous) && old.length === value.length ? null : []
    for (let i=0;i<value.length;i++) {
      const next=shareTree(value[i] ?? null, old[i])
      if (!copy && next!==old[i]) copy=old.slice(0,i)
      if(copy)copy[i]=next
    }
    return copy ? Object.freeze(copy) : old
  }
  const input=value as Record<string,unknown>, old=previous && typeof previous==='object' && !Array.isArray(previous) ? previous as Record<string,unknown> : {}
  const keys=Object.keys(input).filter(key=>input[key]!==undefined)
  let copy:Record<string,unknown>|null=previous && typeof previous==='object' && !Array.isArray(previous) && keys.length===Object.keys(old).length ? null : {}
  for(const key of keys){
    const next=shareTree(input[key],old[key])
    if(!copy && (!(key in old)||next!==old[key]))copy={...old}
    if(copy)copy[key]=next
  }
  if(copy){for(const key of Object.keys(copy))if(!keys.includes(key))delete copy[key];return Object.freeze(copy)}
  return old
}

function freezeTree(value: object) {
  for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeTree(child)
  Object.freeze(value)
}

/** Snapshots share frozen branches; restored drafts and editable state are mutable copies. */
export class HistoryStatePool {
  private revisions = new WeakMap<ModelDraft, ModelDraft>()
  private tokens = new WeakMap<object, number>()
  private nextToken = 0
  private previous: SerializedEditorState | undefined

  capture(state: SerializedEditorState): SerializedEditorState {
    const normalized=serializableEditorState(state)
    const assets=normalized.assets.map(asset=>asset.nativeModel?{...asset,nativeModel:{...asset.nativeModel,revisions:asset.nativeModel.revisions.map(r=>this.revision(r))}}:asset)
    const result=shareTree({...normalized,assets},this.previous) as SerializedEditorState
    this.previous=result
    return result
  }

  private revision(source: ModelDraft) {
    source = toRaw(source)
    const existing = this.revisions.get(source)
    if (existing) return existing
    const copy = JSON.parse(JSON.stringify(source)) as ModelDraft
    freezeTree(copy)
    this.revisions.set(source, copy)
    this.revisions.set(copy, copy)
    this.tokens.set(copy, ++this.nextToken)
    return copy
  }

  clone(state: SerializedEditorState): SerializedEditorState {
    const assets = toRaw(state.assets)
    // Remove heavy published data before JSON traversal, then restore pooled immutable values.
    const stripped = assets.map(asset => asset.nativeModel
      ? { ...asset, nativeModel: { ...asset.nativeModel, revisions: [] } } : asset)
    const copy = JSON.parse(serializeEditorState({ ...state, assets: stripped })) as SerializedEditorState
    copy.assets.forEach((asset, index) => {
      if (asset.nativeModel) asset.nativeModel.revisions = assets[index]!.nativeModel!.revisions.map(revision => this.revision(revision))
    })
    return copy
  }

  /** Equality includes revision identity without repeatedly stringifying immutable vertex arrays. */
  signature(value: SerializedEditorState | { state: SerializedEditorState }) {
    const state = 'state' in value ? value.state : value
    const compact = { ...state, assets: state.assets.map(asset => asset.nativeModel ? {
      ...asset, nativeModel: { ...asset.nativeModel, revisions: asset.nativeModel.revisions.map(revision => {
        const token = this.tokens.get(toRaw(revision))
        return token === undefined ? revision : { immutablePublishedRevision: token }
      }) },
    } : asset) }
    // A shallow projection avoids a JSON replacer callback for every mutable draft vertex.
    return JSON.stringify('state' in value ? { ...value, state: compact } : compact)
  }
}
