import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import '@fontsource/inter/400.css'
import '@fontsource/roboto/400.css'
import '@fontsource/poppins/400.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/roboto-mono/400.css'
import '@fontsource/michroma/400.css'
import '@fontsource/orbitron/400.css'
import '@fontsource/audiowide/400.css'
import '@fontsource/aldrich/400.css'
import './styles.css'
import './cssColorResolver'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
