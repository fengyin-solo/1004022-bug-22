import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { loadChaosFlag } from './api/chaos'
import './styles/global.css'

loadChaosFlag()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
