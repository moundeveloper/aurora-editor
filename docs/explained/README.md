# Explained implementation docs

This folder contains documentation for functionality that is already implemented in
Aurora. Planning documents, proposals, and unfinished architecture work remain in the
parent `docs/` folder.

- [Native modeling](./3d-modeling-implementation.md) — human workflow, shared modeling
  kernel, MCP operations, Knife/X-Ray behavior, region operations, and validation.
- [3D paths](./3d-paths.md) — editable Bézier paths, camera constraints, animation, and
  persistence.
- [Influences](./influences.md) — the current non-destructive geometry influence stack.
- [Node graph](./node-graph.md) — typed sockets, node evaluation, graph interactions, and
  persistence.
- [Project persistence](./project-persistence.md) — IndexedDB schema and save lifecycle.

These documents describe the current implementation and its known limits. Future work is
tracked in the parent roadmap and proposal documents.
