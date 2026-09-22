# Engine optimization verification

Implemented automatic optimizations shared by UI rendering, export and MCP preview:

- Single-pass double-sided transparency for undeformed planes. Rigged cards and
  cards with enabled influences retain the conservative two-pass path.
- AO and depth-of-field passes are created only when active, removed and disposed
  when disabled, and inserted in the correct order when re-enabled. Existing
  quality and camera controls govern this in both UI and MCP.
- Removed duplicate per-object transform evaluation in scene synchronization.
- Skip whole-scene shadow bounds when scene shadows are off or no light casts them.

HUD camera, 720 × 1000, full quality, time zero, Intel UHD / ANGLE:

| Metric | Previous saved result | Optimized result |
| --- | ---: | ---: |
| Draw calls | 47 | 32 |
| Triangles across passes | 92 | 62 |
| Warm median frame including GPU completion | 8.4 ms | 3.4 ms |
| P95, six samples | 17.2 ms | 4.1 ms |

Timing runs were collected at different times and are not a controlled speedup
measurement. Draw-call reduction is deterministic. A decoded RGB comparison of
the corresponding before/after PNGs found zero differing pixels.

Citadel: full-quality 960 × 540 render visually inspected; 185 draw calls,
40,000 instances, zero redundant instance uploads, 7.5 ms median / 10.1 ms P95.
No saved project data, geometry counts, AO or grading settings were changed.

Validation: type-check; 165 scene/rendering tests; HUD UI preset/scrubbing smoke;
Citadel editor selection/edit/undo smoke. Browser tests now wait until the requested
project has finished opening, avoiding measurement of the previously active project.
The grading smoke accepts a scene whose grading is already enabled.

Still outstanding from the research: dependency-based incremental evaluation,
shared resources between render surfaces, structurally shared history, and
transparent-aware depth-of-field rendering. These require separate correctness work.
