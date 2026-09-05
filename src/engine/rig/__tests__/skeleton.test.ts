import { describe, expect, it } from 'vitest'
import {
  applyMatrix, bonePoseMatrices, boneRestMatrix, boneTip, deformPoints, IDENTITY, invert, multiply,
  rigPoseSignature, rigRestSignature, skinWeights,
} from '@/engine/rig/skeleton'
import { createRig, createRigBone } from '@/engine/rig/rigFactory'
import { createRigMesh, deformRig } from '@/engine/rig/rigMesh'
import type { AuroraRig, AuroraRigBone } from '@/models/editor'

function rigWith(...bones: AuroraRigBone[]): AuroraRig {
  const rig = createRig('Test')
  rig.bones = bones
  return rig
}

describe('rig matrices', () => {
  it('composes parent then child and inverts back to identity', () => {
    const bone = createRigBone(1, { x: .5, y: -.25, angle: 30 })
    const rest = boneRestMatrix(bone)
    const roundTrip = multiply(rest, invert(rest))
    roundTrip.forEach((value, index) => expect(value).toBeCloseTo(IDENTITY[index]!))
  })

  it('places the tip along the bone direction', () => {
    const tip = boneTip(createRigBone(1, { x: 0, y: 0, angle: 90, length: .8 }))
    expect(tip.x).toBeCloseTo(0)
    expect(tip.y).toBeCloseTo(.8)
  })

  it('leaves an unposed rig exactly at rest', () => {
    const rig = rigWith(createRigBone(1, { x: -.4, y: .2, angle: 15 }), createRigBone(2, { x: .3, angle: -60 }))
    bonePoseMatrices(rig, 0).forEach((matrix) => {
      matrix.forEach((value, index) => expect(value).toBeCloseTo(IDENTITY[index]!))
    })
  })

  it('rotates a posed bone about its own head', () => {
    const bone = createRigBone(1, { x: 0, y: 0, angle: 0, length: 1 })
    bone.rotation.value = 90
    const [matrix] = bonePoseMatrices(rigWith(bone), 0)
    const moved = applyMatrix(matrix!, 1, 0)
    expect(moved.x).toBeCloseTo(0)
    expect(moved.y).toBeCloseTo(1)
  })

  it('carries a parent pose down to its child without inheriting the parent rest', () => {
    const root = createRigBone(1, { x: 0, y: 0, angle: 90, length: 1 })
    const child = createRigBone(2, { parentId: root.id, x: 0, y: 1, angle: 90, length: 1 })
    root.rotation.value = 90
    const matrices = bonePoseMatrices(rigWith(root, child), 0)
    // The root turns a quarter turn about the origin, so the child's head swings from (0,1) to (-1,0).
    const childHead = applyMatrix(matrices[1]!, 0, 1)
    expect(childHead.x).toBeCloseTo(-1)
    expect(childHead.y).toBeCloseTo(0)
  })

  it('treats a parent cycle as a root instead of hanging', () => {
    const first = createRigBone(1)
    const second = createRigBone(2, { parentId: first.id })
    first.parentId = second.id
    expect(() => bonePoseMatrices(rigWith(first, second), 0)).not.toThrow()
  })
})

describe('rig skinning', () => {
  it('normalises weights and leaves out-of-reach points unweighted', () => {
    const bone = createRigBone(1, { x: 0, y: 0, angle: 0, length: 1, falloff: .5 })
    const points = [{ x: 0, y: 0 }, { x: .5, y: 0 }, { x: -1, y: -1 }]
    const weights = skinWeights(rigWith(bone), points)
    expect(weights[0]).toBeCloseTo(1)
    expect(weights[1]).toBeCloseTo(1)
    expect(weights[2]).toBe(0)
  })

  it('splits a point evenly between two bones the same distance away', () => {
    const left = createRigBone(1, { x: -.5, y: 0, angle: 0, length: 0, falloff: 1 })
    const right = createRigBone(2, { x: .5, y: 0, angle: 0, length: 0, falloff: 1 })
    const weights = skinWeights(rigWith(left, right), [{ x: 0, y: 0 }])
    expect(weights[0]).toBeCloseTo(.5)
    expect(weights[1]).toBeCloseTo(.5)
  })

  it('holds unreached points at rest while moving the ones the bone covers', () => {
    const bone = createRigBone(1, { x: 0, y: 0, angle: 0, length: 1, falloff: .4 })
    bone.offsetY.value = .5
    const rig = rigWith(bone)
    const points = [{ x: .5, y: 0 }, { x: -1, y: -1 }]
    const deformed = deformPoints(points, skinWeights(rig, points), bonePoseMatrices(rig, 0))
    expect(deformed[1]).toBeCloseTo(.5)
    expect(deformed[2]).toBeCloseTo(-1)
    expect(deformed[3]).toBeCloseTo(-1)
  })

  it('keeps an unposed rig pixel-identical to its rest mesh', () => {
    const rig = rigWith(createRigBone(1, { x: 0, y: 0, angle: 45, length: 1, falloff: 2 }))
    const { mesh, positions } = deformRig(rig, bonePoseMatrices(rig, 0), 0)
    mesh.points.forEach((point, index) => {
      expect(positions[index * 2]).toBeCloseTo(point.x)
      expect(positions[index * 2 + 1]).toBeCloseTo(point.y)
    })
  })
})

describe('rig mesh', () => {
  it('spans the rig square and winds two triangles per cell', () => {
    const mesh = createRigMesh(2, 2)
    expect(mesh.points).toHaveLength(9)
    expect(mesh.indices).toHaveLength(2 * 2 * 6)
    expect(mesh.points[0]).toEqual({ x: -1, y: 1 })
    expect(mesh.points[8]).toEqual({ x: 1, y: -1 })
    // UVs run image-style, so the first point is the top-left of the texture.
    expect([mesh.uvs[0], mesh.uvs[1]]).toEqual([0, 0])
  })

  it('clamps a nonsense grid rather than allocating it', () => {
    expect(createRigMesh(0, 0).columns).toBe(1)
    expect(createRigMesh(500, 500).rows).toBe(64)
  })
})

describe('rig bones', () => {
  it('refuses a seed that is not a real number', () => {
    // A viewport with no layout divides by zero, and a bone at NaN would blank the whole deform.
    const bone = createRigBone(1, { x: Number.NaN, y: Number.POSITIVE_INFINITY, angle: Number.NaN, length: -4 })
    expect(bone.x).toBe(0)
    expect(bone.y).toBe(0)
    expect(bone.angle).toBe(90)
    expect(bone.length).toBe(0)
    expect(bone.falloff).toBeGreaterThan(0)
  })
})

describe('rig signatures', () => {
  it('separates rest changes from pose changes', () => {
    const bone = createRigBone(1)
    const rig = rigWith(bone)
    const rest = rigRestSignature(rig)
    const pose = rigPoseSignature(rig, 0)
    bone.rotation.value = 25
    expect(rigRestSignature(rig)).toBe(rest)
    expect(rigPoseSignature(rig, 0)).not.toBe(pose)
    bone.length = 2
    expect(rigRestSignature(rig)).not.toBe(rest)
  })

  it('follows keyframed pose channels through time', () => {
    const bone = createRigBone(1)
    bone.rotation.animated = true
    bone.rotation.keyframes = [
      { id: 'a', time: 0, value: 0, interpolation: 'linear' },
      { id: 'b', time: 2, value: 90, interpolation: 'linear' },
    ]
    const rig = rigWith(bone)
    expect(rigPoseSignature(rig, 0)).not.toBe(rigPoseSignature(rig, 1))
  })
})
