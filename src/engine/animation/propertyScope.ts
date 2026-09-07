import type { AnimatableProperty } from '@/models/editor'
export interface NumericScope {
  properties: Map<string, AnimatableProperty<number>>
  audio?: (layerId: string, time: number) => number
}
export const numericScopes = new WeakMap<AnimatableProperty<number>, NumericScope>()

export function collectNumericProperties(root: unknown) {
  const properties = new Map<string, AnimatableProperty<number>>()
  const seen = new Set<object>()
  function visit(value: unknown) {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    const candidate = value as AnimatableProperty<number>
    if (typeof candidate.id === 'string' && typeof candidate.value === 'number' && Array.isArray(candidate.keyframes)) {
      properties.set(candidate.id, candidate); return
    }
    Object.values(value).forEach(visit)
  }
  visit(root)
  return properties
}

export function bindNumericScope(root: unknown, audio?: NumericScope['audio'], replace = true) {
  const scope: NumericScope = { properties: collectNumericProperties(root), audio }
  for (const property of scope.properties.values()) if (replace || !numericScopes.has(property)) numericScopes.set(property, scope)
  return scope
}

/** Keep copied scene instances independent while preserving their internal driver links. */
export function renewNumericPropertyIds(root: unknown) {
  const properties = collectNumericProperties(root), ids = new Map<string, string>()
  for (const property of properties.values()) {
    const id = crypto.randomUUID()
    ids.set(property.id, id); property.id = id
    for (const key of property.keyframes) key.id = crypto.randomUUID()
  }
  for (const property of properties.values()) if (property.driver) property.driver.sourceId = ids.get(property.driver.sourceId) ?? property.driver.sourceId
}
