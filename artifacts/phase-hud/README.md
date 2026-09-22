# PHASE / Animated HUD

Final saved Aurora project: `71f03e17-901e-4f10-aaa1-51d866c099e8`.
1080 × 1500, 30 fps, 12-second loop. Open it in the project browser and press Play.

Inspired by the supplied reference: tilted dark telemetry, cyan tabs, orange
node markers, tiny technical labels, faint circuit routing, and shallow focus.
Animated elements include scan cursors, status pulses, acquisition sweep, camera
drift, and focus. The scene uses 15 image-card objects; detailed artwork is SVG.

The small GIF preview is sampled at 3 fps. The Aurora project is the full 30 fps
editable animation. The shared preset is `shared/phaseHud.ts`; both MCP and the
project-browser button call it. Text inside cards is embedded SVG artwork.
Animated film grain and chromatic aberration are not implemented.

Validation: type-check and 170 relevant Vitest tests passed; actual MCP camera
frames inspected; browser UI preset creation and timeline scrubbing passed with
all HTTP writes blocked. `ui-check.json` records measurements and errors.
