# Project persistence

Aurora stores project state in the `aurora-editor` IndexedDB database through Dexie.

## Schema

- `projects`: project metadata keyed by project ID.
- `layers`: ordered layer records indexed by project ID.
- `scenes3D`: ordered serialized 3D scene records, including object, camera, and light transforms.
- `assets`: ordered media metadata indexed by project ID.
- `settings`: database-level values such as the active project ID.

Three.js runtime objects, renderer resources, DOM nodes, and object URLs are not persisted. They are rebuilt from the serialized scene definitions.

## Save lifecycle

Edits mark the project dirty and schedule a debounced IndexedDB transaction. A manual save or workspace transition flushes the pending transaction; document hide and page unload also request an immediate flush. Each transaction replaces the ordered aggregates for that project atomically.

On first launch after this migration, Aurora imports the existing `aurora-editor-project` localStorage snapshot into IndexedDB. The legacy value is removed only after the IndexedDB save succeeds.
