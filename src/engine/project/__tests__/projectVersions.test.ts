import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '@/stores/editor'
import { ProjectVersionDatabase, snapshotDiff } from '../projectVersions'

describe('project versions', () => {
  it('persists immutable snapshots and restores through undo', async () => {
    setActivePinia(createPinia())
    const store = useEditorStore(), database = new ProjectVersionDatabase(crypto.randomUUID())
    try {
      const snapshot = await database.capture('Before', store.projectSnapshot())
      store.addTimelineLayer('rectangle')
      const changedCount = store.layers.length
      const saved = (await database.versions.get(snapshot.id))!
      expect(saved.snapshot.layers.length).toBe(changedCount - 1)
      store.restoreProjectVersion(saved.snapshot)
      expect(store.layers.length).toBe(changedCount - 1)
      store.undo()
      expect(store.layers.length).toBe(changedCount)
    } finally { await database.delete() }
  })
  it('compares entities by id, names changes, and ignores save timestamps', () => {
    const a = { updatedAt: 1, layers: [{ id: 'x', name: 'Title', opacity: 1 }] }
    const b = { updatedAt: 2, layers: [{ id: 'x', name: 'Title', opacity: .5 }] }
    expect(snapshotDiff(a, b)).toEqual([{ path: 'layers / Title / opacity', before: '1', after: '0.5' }])
  })
})
