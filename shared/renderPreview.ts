import type { SerializedEditorState } from '../src/models/editor.ts'
import { z } from 'zod'

export const renderPreviewOptionsSchema=z.object({
  projectId:z.string().min(1),sceneId:z.string().optional(),cameraId:z.string().optional(),
  time:z.number().min(0).default(0),duration:z.number().min(0).max(30).default(0),
  width:z.number().int().min(64).max(1920).default(960),height:z.number().int().min(64).max(1080).default(540),
  quality:z.enum(['draft','preview','full']).optional(),benchmarkFrames:z.number().int().min(1).max(600).default(6),
}).strict()

export interface RenderPreviewRequest {
  snapshot: SerializedEditorState
  sceneId?: string
  cameraId?: string
  time: number
  duration?: number
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
  sampleStart?: number
  sampleEnd?: number
  sampleCount?: number
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
