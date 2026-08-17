import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useDashboardStore } from './store'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Without this, an uncaught render error (e.g. a widget with malformed data)
// unmounts the entire React root, leaving a blank/gray window with no way
// back — see the "Left Panel" investigation. Logged via console.error, which
// main/index.ts's console-message forwarder relays to the terminal running
// electron-vite dev, so a crash here is diagnosable without opening DevTools.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[boarderoni] renderer crashed:', error.stack ?? error.message, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: '#14161b',
            color: '#e8e8ea',
            fontFamily: 'sans-serif',
            padding: 24,
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong rendering this screen.</div>
          <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 600, wordBreak: 'break-word' }}>{this.state.error.message}</div>
          <button
            onClick={() => {
              // Just clearing the error would immediately re-crash on the
              // same broken screen (store state, unlike this component's own
              // state, survives the unmount) — send the user back to the
              // main deck first, same as a stale/missing sub-deck reference
              // already falls back to (see getSubDeckWidgets).
              useDashboardStore.getState().setEditingSubDeck(null)
              this.setState({ error: null })
            }}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#5b8def', color: 'white', cursor: 'pointer' }}
          >
            Back to main deck
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
