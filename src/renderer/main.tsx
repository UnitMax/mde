import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './index.css'
import { App } from './App'
import { initTerminalBridge } from './terminal/sessions'
import { getTerminalSettings } from './terminal/terminal-settings'
import { applyApplicationTheme } from './theme/themes'

// Registered before the first render so no PTY output can arrive unclaimed.
initTerminalBridge()
applyApplicationTheme(getTerminalSettings().theme)

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
