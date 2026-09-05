import { describe, expect, it } from 'vitest'
import { assignShortcut, matchesShortcut, shortcutFromEvent } from '../keymap'

describe('command keymap', () => {
  it('normalizes portable primary-modifier and navigation shortcuts', () => {
    expect(shortcutFromEvent({ key: 'k', ctrlKey: false, metaKey: true, altKey: false, shiftKey: true })).toBe('Ctrl+Shift+K')
    expect(shortcutFromEvent({ key: 'ArrowLeft', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe('ArrowLeft')
    expect(matchesShortcut({ key: 'z', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, 'Ctrl+Z')).toBe(true)
  })

  it('keeps shortcut assignments unique', () => {
    expect(assignShortcut({ undo: 'Ctrl+Z', custom: 'Ctrl+P' }, 'custom', 'Ctrl+Z')).toEqual({ undo: '', custom: 'Ctrl+Z' })
  })
})
