import { useEffect, useState } from 'react'
import { useDashboardStore } from '../store'

// The MCP server's own settings panel (see main/mcp/, main/mcpServerSettings.ts)
// — token display/copy/regenerate, modeled directly on
// RestDataSourcesSettingsPanel's own token UI. The enable/disable checkbox
// itself lives in PluginsModal (this panel is just PLUGIN_SETTINGS_PANELS'
// entry for the 'mcp' kind, same extension point every other kind here
// uses) — this panel only shows read-only status plus the token.
export function McpServerSettingsPanel(): React.JSX.Element {
  const settings = useDashboardStore((s) => s.mcpServerSettings)
  const requestMcpServerSettings = useDashboardStore((s) => s.requestMcpServerSettings)
  const regenerateMcpServerToken = useDashboardStore((s) => s.regenerateMcpServerToken)

  const [copied, setCopied] = useState(false)

  useEffect(() => {
    requestMcpServerSettings()
  }, [requestMcpServerSettings])

  function handleCopy(token: string): void {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (!settings) return <p className="properties__hint">Loading…</p>

  const url = `http://127.0.0.1:${settings.port}/mcp`

  return (
    <div className="settings-modal__sources">
      <p className="properties__hint">
        Lets an MCP client (an AI agent) read and edit this app's live decks directly — create/patch widgets, read/set
        variables, trigger actions, manage event sources. Reachable from other machines on your network too, so the
        bearer token below is what protects it: whatever holds that token gets full write access to every deck.
      </p>

      {!settings.listening && (
        <p className="properties__hint dcsbios-settings__error">
          {settings.listenError ? `Not listening: ${settings.listenError}` : 'Enable "MCP Server" above to start listening.'}
        </p>
      )}

      <label className="dcsbios-settings__field">
        <span>Bearer token</span>
        <div className="properties__file-row">
          <input readOnly value={settings.bearerToken} />
          <button type="button" className="properties__file-button" onClick={() => handleCopy(settings.bearerToken)}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button type="button" className="properties__file-button" onClick={() => regenerateMcpServerToken()}>
            Regenerate
          </button>
        </div>
        <span className="properties__hint-inline">Regenerating immediately invalidates any client already using the old token.</span>
      </label>

      <div className="dcsbios-settings__field">
        <span>Endpoint</span>
        <p className="properties__hint-inline">
          {url} (header: Authorization: Bearer &lt;token&gt;). From another machine, use this computer's LAN address
          instead of 127.0.0.1.
        </p>
      </div>
    </div>
  )
}
