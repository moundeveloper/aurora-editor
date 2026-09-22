import type { SerializedEditorState } from '../src/models/editor.ts'

export interface RenderPreviewRequest {
  snapshot: SerializedEditorState
  sceneId?: string
  cameraId?: string
  time: number
  width: number
  height: number
  quality?: 'draft' | 'preview' | 'full'
  benchmarkFrames: number
}

export interface RenderPreviewResult {
  png: string
  projectId: string
  sceneId: string
  cameraId: string
  width: number
  height: number
  quality: string
  metrics: {
    firstSyncMs: number
    syncMedianMs: number
    syncP95Ms: number
    frameMedianMs: number
    frameP95Ms: number
    drawCalls: number
    triangles: number
    instances: number
    instanceUploadsDuringBenchmark: number
    renderer: string
  }
}

declare global {
  interface Window { auroraPreviewResult?: RenderPreviewResult; auroraPreviewError?: string }
}
