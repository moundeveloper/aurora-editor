import { createRouter, createWebHistory } from 'vue-router'

// App.vue owns both full-screen surfaces; these records provide URL identity and history only.
const routeSurface = { render: () => null }

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: routeSurface },
    { path: '/projects/:projectId', name: 'project', component: routeSurface },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
