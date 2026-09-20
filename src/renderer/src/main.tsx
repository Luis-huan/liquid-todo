import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './styles/base.css'
import './styles/glass.css'
import './styles/app.css'
import App from './App'
import CalendarApp from './CalendarApp'
import HistoryApp from './HistoryApp'

const container = document.getElementById('root')
if (container) {
  const page = window.location.hash.replace('#', '')
  const view = page === 'history' ? <HistoryApp /> : page === 'calendar' ? <CalendarApp /> : <App />
  createRoot(container).render(<StrictMode>{view}</StrictMode>)
}
