import type { Aurora3DScene, AuroraCameraCut } from '@/models/editor'

export function sortedCameraCuts(scene: Aurora3DScene) {
  return [...(scene.cameraCuts ?? [])].sort((left, right) => left.time - right.time)
}

export function cameraIdAtTime(scene: Aurora3DScene, time: number) {
  const cuts = sortedCameraCuts(scene)
  let cameraId = scene.activeCameraId
  cuts.forEach((cut) => { if (cut.time <= time) cameraId = cut.cameraId })
  return cameraId
}

export function normalizeCameraCuts(scene: Aurora3DScene, cuts: AuroraCameraCut[] | undefined = scene.cameraCuts) {
  const cameraIds = new Set(scene.cameras.map((camera) => camera.id))
  const byTime = new Map<number, AuroraCameraCut>()
  ;(cuts ?? [])
    .filter((cut) => cut?.id && cameraIds.has(cut.cameraId) && Number.isFinite(cut.time))
    .forEach((cut) => {
      const time = Math.max(0, cut.time)
      byTime.set(time, { ...cut, time })
    })
  const restored = [...byTime.values()].sort((left, right) => left.time - right.time)
  const fallbackCameraId = cameraIds.has(scene.activeCameraId ?? '') ? scene.activeCameraId : scene.cameras[0]?.id ?? null
  if (!fallbackCameraId) return []
  if (!restored.length || restored[0]!.time > 0) restored.unshift({ id: `camera-cut-${scene.id}-0`, cameraId: fallbackCameraId, time: 0 })
  restored[0]!.time = 0
  return restored
}
