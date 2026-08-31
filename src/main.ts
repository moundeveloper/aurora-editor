import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useEditorStore } from './stores/editor'
import './styles/main.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

const editorStore = useEditorStore(pinia)
await editorStore.initializePersistence()
window.addEventListener('beforeunload', () => { void editorStore.flushProjectSave() })
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void editorStore.flushProjectSave()
})

app.mount('#app')
