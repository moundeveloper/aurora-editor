export type CommandShortcutMap = Record<string, string>

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

export function shortcutFromEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) {
  if (MODIFIER_KEYS.has(event.key)) return ''
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const key = event.key === ' ' ? 'Space'
    : event.key.length === 1 ? event.key.toUpperCase()
      : event.key.replace(/^Arrow/, 'Arrow')
  parts.push(key)
  return parts.join('+')
}

export function matchesShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, shortcut: string) {
  return shortcutFromEvent(event) === shortcut
}

export function assignShortcut(keymap: CommandShortcutMap, commandId: string, shortcut: string) {
  const next = { ...keymap }
  for (const [id, assigned] of Object.entries(next)) {
    if (id !== commandId && assigned === shortcut) next[id] = ''
  }
  next[commandId] = shortcut
  return next
}
