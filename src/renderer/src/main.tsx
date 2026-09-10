import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './styles/base.css'
import './styles/glass.css'
import './styles/app.css'
import App from './App'
import HistoryApp from './HistoryApp'

const container = document.getElementById('root')
if (container) {
  const isHistory = window.location.hash.replace('#', '') === 'history'
  createRoot(container).render(<StrictMode>{isHistory ? <HistoryApp /> : <App />}</StrictMode>)
}
