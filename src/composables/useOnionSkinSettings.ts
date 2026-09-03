import { reactive } from 'vue'
import { DEFAULT_ONION_SKIN_SETTINGS, type OnionSkinSettings } from '@/engine/rendering/onionSkin'

// Viewport-only session state: intentionally absent from project serialization and editor history.
const settings = reactive<OnionSkinSettings>({ ...DEFAULT_ONION_SKIN_SETTINGS })

export function useOnionSkinSettings() {
  return settings
}
