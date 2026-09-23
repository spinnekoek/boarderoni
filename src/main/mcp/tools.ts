// MCP tool definitions + dispatch — see docs/TODO.md's "MCP server for
// boarderoni" item for why this exists. Every tool here reaches live app
// state through McpDeps, a small set of functions main/index.ts binds and
// passes in (see syncMcpServer's call site there) rather than this module
// importing them directly from '../index' — that would create a real
// runtime circular require (index.ts -> mcp/server.ts -> mcp/tools.ts ->
// index.ts), since index.ts also has to import this module's own
// createMcpTools to start the server. Only a `import type { DeckRoom }`
// crosses back to index.ts, which is erased at compile time and creates no
// such cycle.
//
// Widget/Plugin input schemas are NOT hand-written — see
// scripts/generate-mcp-schemas.ts, which derives them straight from
// shared/types.ts's own Widget/Plugin exports via ts-json-schema-generator,
// so a future widget type or field is covered here automatically the next
// time that script runs, rather than silently drifting out of sync (the
// TODO's own stated requirement for this feature).
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Dashboard, DeckSummary, GlobalAction, Plugin, RestDataSource, SequenceStep, ServerToClient, Widget, WidgetAction, WidgetEventKind } from '../../shared/types'
import type { DeckRoom } from '../index'
import type { AppSettings } from '../appSettings'
import { getAppSettings } from '../appSettings'
import { PLUGIN_TYPES, getPluginType } from '../../shared/plugins'
import { findWidgetAnywhere, getSubDeckWidgets, setSubDeckWidgets } from '../../shared/subDecks'
import { toVariableMap } from '../../shared/expr'
// Sandboxed main-process-only evaluator, not shared/expr.ts's own plain
// `new Function` version — see sandboxedExpr.ts's own top comment.
import { tryEvaluateExpression } from '../sandboxedExpr'
import { MCP_SCHEMAS } from '../../shared/generated/mcpSchemas'
import { captureDashboardScreenshot, captureWidgetScreenshot } from './screenshot'
// list_variables' own metadata enrichment, plus the list_dcs_bios_*
// discovery tools below. Live per-aircraft/live fetches, not static data,
// since what each returns depends on config.aircraft or what's actually
// installed/plugged in right now, not just the plugin kind.
import { getFieldCatalog, getCommandCatalog, listInstalledAircraft } from '../dcsBios/connectionManager'
import { listDevices as listWindowsAudioDevices } from '../windowsAudio/connectionManager'
import { listDisplays } from '../screenCapture'
// Read-only — no circular-require concern (neither file imports '../index')
// unlike create/update, which route through McpDeps below since those need
// applyRestIncoming's own emit callback, which IS main/index.ts-local.
import { getRestDataSources } from '../restDataSources'
import { getRestWebhookTargets } from '../restWebhookTargets'
import { getRestListenStatus } from '../restIncoming'

export interface McpDeps {
  getOrLoadRoom: (deckId: string) => DeckRoom | null
  listDeckSummaries: () => DeckSummary[]
  // Deck lifecycle. Deliberately create/rename only — deleting a deck is
  // irreversible and goes through a confirmation dialog everywhere a human
  // can trigger it, which an MCP client has no equivalent of, so it isn't
  // exposed here.
  createDeck: (name: string) => DeckSummary
  renameDeck: (deckId: string, name: string) => DeckSummary | null
  applyVariableUpdates: (room: DeckRoom, updates: Record<string, unknown>, options: { immediate: boolean }) => void
  applyDashboardUpdate: (room: DeckRoom, dashboard: Dashboard, final: boolean) => void
  applyAppSettingsPatch: (patch: Partial<AppSettings>) => Promise<AppSettings>
  triggerAction: (room: DeckRoom, widgetId: string, event: WidgetEventKind, value: number | undefined, final: boolean) => Promise<ServerToClient[]>
  // send_action only — runs one WidgetAction directly (runActionStep, not
  // runSequence/triggerAction's whole-event-sequence path), with no widget
  // or event behind it. Same "collect replies into an array" shape as
  // triggerAction above, for the same reason (no real client socket to
  // target a navigate-subdeck/open-overlay/close-overlay reply at).
  runAction: (room: DeckRoom, action: WidgetAction) => Promise<ServerToClient[]>
  // send_actions only — runs an ad-hoc SequenceStep[] (delay/action/condition
  // steps, same union create_widget/update_widget store on a widget event)
  // through the real runSteps engine, so a delay step is an actual awaited
  // setTimeout server-side rather than something the MCP client has to pace
  // itself with separate send_action calls plus its own external sleep.
  runActions: (room: DeckRoom, steps: SequenceStep[]) => Promise<ServerToClient[]>
  // Screenshot tools only (see main/mcp/screenshot.ts) — getEditorDeckId is
  // '' for the lobby/no deck, undefined if the desktop editor has no live
  // connection at all right now (e.g. minimized before its own WS ever
  // connected, which shouldn't normally happen but is handled the same as
  // "no match" either way).
  getEditorWindow: () => BrowserWindow | null
  getEditorDeckId: () => string | undefined
  // hide_editor_window/show_editor_window tools only — the same hide-to-
  // tray/restore behavior the app's own tray icon already exposes, callable
  // from an MCP client so it can e.g. show the editor before a screenshot
  // tool call (which requires the window visible — see screenshot.ts's own
  // requireVisibleWindow) and hide it again afterward.
  hideEditorWindow: () => void
  showEditorWindow: () => void
  // create_rest_data_source/update_rest_data_source only — routed through
  // McpDeps rather than a direct import of createRestDataSource/
  // updateRestDataSources (unlike the read-only list_rest_data_sources'
  // own getRestDataSources import above) because a real create/update also
  // has to restart the app's REST listeners via syncRestIncomingServers,
  // whose own `emit` callback (applyRestIncoming) is main/index.ts-local —
  // same reasoning as every other McpDeps entry.
  createRestDataSource: (name: string) => RestDataSource
  updateRestDataSource: (sourceId: string, patch: Record<string, unknown>) => RestDataSource | null
}

class McpToolError extends Error {}

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function requireRoom(deps: McpDeps, deckId: unknown): DeckRoom {
  if (typeof deckId !== 'string' || !deckId) throw new McpToolError('deckId is required')
  const room = deps.getOrLoadRoom(deckId)
  if (!room) throw new McpToolError(`Unknown deck: ${deckId}`)
  return room
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value) throw new McpToolError(`${key} is required`)
  return value
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

// Finds which sub-deck (if any) currently holds widgetId — null means the
// main deck. Unlike findWidgetAnywhere (which just returns the widget),
// update/delete need to know which of getSubDeckWidgets/setSubDeckWidgets'
// views to write the result back into.
function widgetSubDeckId(dashboard: Dashboard, widgetId: string): string | null {
  for (const subDeck of dashboard.subDecks ?? []) {
    if (subDeck.widgets.some((w) => w.id === widgetId)) return subDeck.id
  }
  return null
}

interface VariableMeta {
  label?: string
  category?: string
  valueRange?: { max: number }
}

// list_variables' own enrichment — a raw {id, name, value} tells an MCP
// client nothing about what a variable MEANS, which is especially opaque for
// DCS-BIOS-sourced ones (terse control identifiers like
// UFC_COMM1_CHANNEL_SEL). Built by walking each Plugin instance's own
// mappings (field -> variableName) and cross-referencing that plugin kind's
// field metadata: PluginTypeMeta.fields for a statically-known kind, or
// DCS-BIOS's own per-aircraft field catalog (necessarily fetched live, since
// which fields exist depends on config.aircraft, not just the kind) for that
// one dynamic-fields kind. A variable with no mapping behind it (set
// directly via set_variable, or produced by an expr's own object-return
// path — see PluginMapping's own comment in shared/types.ts) simply gets no
// metadata, same as one fed by a plugin kind with no such data to offer at
// all.
async function describeVariables(dashboard: Dashboard): Promise<Map<string, VariableMeta>> {
  const meta = new Map<string, VariableMeta>()
  for (const plugin of dashboard.plugins ?? []) {
    if (plugin.kind === 'dcsbios') {
      const aircraft = plugin.config?.aircraft
      if (typeof aircraft !== 'string' || !aircraft) continue
      const catalog = await getFieldCatalog(aircraft)
      const byKey = new Map(catalog.map((f) => [f.key, f]))
      for (const mapping of plugin.mappings) {
        const entry = byKey.get(mapping.field)
        if (!entry) continue
        meta.set(mapping.variableName, {
          label: entry.label,
          category: entry.category,
          ...(entry.maxValue !== undefined ? { valueRange: { max: entry.maxValue } } : {})
        })
      }
      continue
    }
    const typeMeta = getPluginType(plugin.kind)
    if (!typeMeta || typeMeta.fields.length === 0) continue
    const byKey = new Map(typeMeta.fields.map((f) => [f.key, f]))
    for (const mapping of plugin.mappings) {
      const field = byKey.get(mapping.field)
      if (field) meta.set(mapping.variableName, { label: field.label })
    }
  }
  return meta
}

// Embeds one of MCP_SCHEMAS' self-contained {$ref, definitions} schemas as a
// named property inside a hand-written wrapper object schema. MCP's
// Tool.inputSchema must itself be `{type: 'object', properties, ...}` at the
// top level — Widget/Plugin are discriminated unions, not objects, so
// neither can BE a tool's whole inputSchema directly; every tool that takes
// one embeds it as a single property instead. `definitions` has to live at
// the wrapper's own root for the embedded $ref to resolve, so it's hoisted
// up into the wrapper's own inputSchema rather than nested under the
// property itself.
function objectSchema(properties: Record<string, unknown>, required: string[], definitions?: Record<string, unknown>): Tool['inputSchema'] {
  return { type: 'object', properties, required, ...(definitions ? { definitions } : {}) } as Tool['inputSchema']
}

function refProperty(named: { $ref: string; definitions: Record<string, unknown> }): { schema: object; definitions: Record<string, unknown> } {
  return { schema: { $ref: named.$ref }, definitions: named.definitions as Record<string, unknown> }
}

const DECK_ID_PROP = { type: 'string', description: 'The deck id, as returned by list_decks.' }

// Shared verbatim across evaluate_expression, create_widget, update_widget,
// create_global_action, and update_global_action's own descriptions below —
// every one of those accepts at least one expression string (a *Expr widget
// field, evaluate_expression's own `expr`, or a global action's
// `condition`), and an MCP client with no other context has no way to infer
// any of this from the field's name alone. Confirmed live: another LLM
// driving this server once wrote a bare `variables.FOO > 1` with no
// `return`, which silently evaluates to undefined instead of erroring —
// exactly the mistake this exists to head off.
const EXPRESSION_SEMANTICS =
  "An expression is a JS function body (`new Function('variables', 'console', code)`), NOT a single implicit-return expression — write `return <value>`, not just `<value>`; a bare `variables.FOO > 1` silently evaluates to undefined rather than erroring. Multiple statements, local `const`/`function` helpers, and loops are all valid, same as any real function body. `variables.NAME` reads that variable's current value; `console.log(...)` is forwarded to the app's own debug panel. Example: `return variables.THROTTLE > 0.9 ? 'red' : 'green'`."

// Shared by create_widget/update_widget below — a label's displayed text
// isn't necessarily plain text, and neither a literal '\n' nor an assumption
// that it's plain-text-only will do what an MCP client might expect.
const LABEL_TEXT_SEMANTICS =
  "A label's displayed text (WidgetLabel.text, or whatever its textExpr evaluates to) can embed U+2424 '␤' to force a line break — what Shift+Enter inserts in the label's own plain-text input, since a single-line input can't hold a literal newline; a literal '\\n' character does NOT create a line break. `{{icon:fa-name}}` tokens (e.g. `{{icon:fa-image}}`) render an inline FontAwesome icon in place."

// Shared by create_widget/update_widget below — a SendDcsCommandAction's
// identifier/interface/argument are DCS-BIOS's own aircraft-specific
// protocol vocabulary, same "don't guess it" reasoning as a dcsbios event
// source's mapping.field (see create_event_source's own description).
const DCS_COMMAND_SEMANTICS =
  'A SendDcsCommandAction targets one (identifier, interface) pair from that aircraft — get valid ones from list_dcs_bios_commands (aircraft id from list_dcs_bios_aircraft) rather than guessing; the right `argument` shape depends on which interface was picked.'

// Shared by create_widget/update_widget below — UpdateStateAction.code is an
// expression too, but its RETURN CONTRACT is different from every *Expr
// field EXPRESSION_SEMANTICS describes, so it needs calling out separately
// rather than being lumped in with that shared text.
const UPDATE_STATE_SEMANTICS =
  "UpdateStateAction.code is an expression (same function-body rules as above) but with a DIFFERENT return contract than every *Expr field: it must return a plain object of {variableName: newValue} pairs to merge into the deck's variables (creating any that don't exist yet), not a single value. Example: `return {THROTTLE: variables.THROTTLE + 0.1}`."

// Shared by create_widget/update_widget below — a CallRestAction's targetId
// references an app-wide, independently-managed RestWebhookTarget, same
// "don't guess it" reasoning as SendDcsCommandAction above.
const CALL_REST_SEMANTICS =
  "A CallRestAction.targetId references one REST webhook target — get valid ones from list_rest_webhook_targets rather than guessing. `values` is an array of {placeholder, value, expr?} entries, one per {{placeholderName}} token that target's own headers/payloadTemplate actually contain (a stale entry whose token no longer exists is simply ignored); `expr`, when set, takes precedence over the static `value`, same static-vs-expr precedence as SendDcsCommandAction.argument/argumentExpr."

interface ToolDef {
  tool: Tool
  handler: (deps: McpDeps, args: Record<string, unknown>) => Promise<CallToolResult> | CallToolResult
}

// Screenshot tools need real pixels, which only exist if the editor window
// is actually showing this exact deck right now — unlike every JSON-only
// tool above, which can operate on any deck getOrLoadRoom can load into
// memory regardless of whether a window has it open. Throws instead of
// navigating the editor to a different deck out from under the user, which
// would be a visible, disruptive side effect of what looks like a read-only
// request.
function requireEditorWindowOnDeck(deps: McpDeps, deckId: string): BrowserWindow {
  const win = deps.getEditorWindow()
  if (!win) throw new McpToolError('The editor window is not open — call show_editor_window first')
  if (deps.getEditorDeckId() !== deckId) {
    throw new McpToolError(`Deck ${deckId} is not currently open in the editor window — screenshots only work for the deck actually on screen.`)
  }
  return win
}

function buildTools(): ToolDef[] {
  const widgetRef = refProperty(MCP_SCHEMAS.Widget)
  const pluginRef = refProperty(MCP_SCHEMAS.Plugin)
  const globalActionRef = refProperty(MCP_SCHEMAS.GlobalAction)
  const actionRef = refProperty(MCP_SCHEMAS.WidgetAction)
  const stepRef = refProperty(MCP_SCHEMAS.SequenceStep)

  return [
    {
      tool: { name: 'list_decks', description: 'List every deck (dashboard) this app knows about.', inputSchema: objectSchema({}, []) },
      handler: (deps) => textResult(deps.listDeckSummaries())
    },
    {
      tool: {
        name: 'create_deck',
        description: 'Create a new, empty deck and return its id and name. The id is generated here — use it for every other tool call against this deck.',
        inputSchema: objectSchema({ name: { type: 'string', description: 'Display name for the new deck.' } }, ['name'])
      },
      handler: (deps, args) => textResult(deps.createDeck(requireString(args, 'name')))
    },
    {
      tool: {
        name: 'rename_deck',
        description: "Change an existing deck's display name. Does not affect its id or any of its content.",
        inputSchema: objectSchema({ deckId: DECK_ID_PROP, name: { type: 'string' } }, ['deckId', 'name'])
      },
      handler: (deps, args) => {
        const deckId = requireString(args, 'deckId')
        const renamed = deps.renameDeck(deckId, requireString(args, 'name'))
        if (!renamed) throw new McpToolError(`Unknown deck: ${deckId}`)
        return textResult(renamed)
      }
    },
    {
      tool: {
        name: 'get_dashboard',
        description: "Get a deck's full current dashboard (widgets, variables, event sources, sub-decks).",
        inputSchema: objectSchema({ deckId: DECK_ID_PROP }, ['deckId'])
      },
      handler: (deps, args) => textResult(requireRoom(deps, args.deckId).dashboard)
    },
    {
      tool: {
        name: 'list_variables',
        description:
          "List a deck's current variables and their live values. Where the event source feeding a variable has descriptive metadata, each entry also carries `label` (human-readable name), `category` (grouping), and `valueRange` (e.g. `{max: 65535}` for an integer field) — most useful for DCS-BIOS-sourced variables, whose raw names are terse control identifiers (e.g. `UFC_COMM1_CHANNEL_SEL`) that don't say what they mean on their own. A variable set directly via set_variable, or with no plugin mapping behind it, has none of these — just `id`/`name`/`value`.",
        inputSchema: objectSchema({ deckId: DECK_ID_PROP }, ['deckId'])
      },
      handler: async (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const variables = room.dashboard.variables ?? []
        const meta = await describeVariables(room.dashboard)
        return textResult(variables.map((v) => ({ ...v, ...meta.get(v.name) })))
      }
    },
    {
      tool: {
        name: 'set_variable',
        description: 'Set one or more variables on a deck (creates any that do not exist yet). Values must be string, number, or boolean.',
        inputSchema: objectSchema(
          {
            deckId: DECK_ID_PROP,
            updates: { type: 'object', description: 'Map of variable name -> new value.', additionalProperties: true }
          },
          ['deckId', 'updates']
        )
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const updates = args.updates
        if (!updates || typeof updates !== 'object') throw new McpToolError('updates must be an object')
        deps.applyVariableUpdates(room, updates as Record<string, unknown>, { immediate: true })
        return textResult(room.dashboard.variables ?? [])
      }
    },
    {
      tool: {
        name: 'evaluate_expression',
        description: `Dry-run a JS expression (the same kind used in any *Expr widget field or a global action's condition) against a deck's current variables, without writing it anywhere. Useful to test an expression before committing it via update_widget. ${EXPRESSION_SEMANTICS}`,
        inputSchema: objectSchema({ deckId: DECK_ID_PROP, expr: { type: 'string' } }, ['deckId', 'expr'])
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const expr = requireString(args, 'expr')
        const result = tryEvaluateExpression(expr, toVariableMap(room.dashboard.variables ?? []))
        return textResult(result)
      }
    },
    {
      tool: {
        name: 'trigger_action',
        description:
          "Fire one of a widget's events, running whatever action sequence is attached to it — same as a real press in the app. Which `event` values are valid depends on the widget's own type (see get_dashboard/get widget.type first): gauge-bar/gauge-arc/screen-capture/label can't be triggered at all; most other widgets only support press/release; button additionally supports doublePress/triplePress; adjuster-slider/adjuster-knob additionally supports move; encoder swaps move for increment/decrement. Switch-shaped widgets (switch-rocker, switch-dial, switch-toggle, dropdown) use `select` instead of a fixed set — `value` is the target position's index into widget.positions, which fires that position's own onSelect plus the widget's overall positionChange; switch-toggle also has guardToggle, switch-dial also has increment/decrement (steps to the adjacent position) and doublePress/triplePress. An invalid (widget, event) pair returns a clean error rather than doing anything, so it's safe to try.",
        inputSchema: objectSchema(
          {
            deckId: DECK_ID_PROP,
            widgetId: { type: 'string' },
            event: { type: 'string', description: 'e.g. press, release, select, increment, decrement, doublePress, triplePress, guardToggle, positionChange — see this tool\'s own description for which apply to which widget type.' },
            value: { type: 'number', description: 'Optional — a position index for select/increment/decrement (switch-shaped widgets), or a live drag value for move.' }
          },
          ['deckId', 'widgetId', 'event']
        )
      },
      handler: async (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const widgetId = requireString(args, 'widgetId')
        const event = requireString(args, 'event') as WidgetEventKind
        const value = typeof args.value === 'number' ? args.value : undefined
        const replies = await deps.triggerAction(room, widgetId, event, value, true)
        const errorReply = replies.find((r): r is Extract<ServerToClient, { type: 'action:error' }> => r.type === 'action:error')
        if (errorReply) return errorResult(errorReply.message)
        return textResult({ ok: true })
      }
    },
    {
      tool: {
        name: 'send_action',
        description:
          `Run one action against a deck right now, with no widget needed as a vehicle for it — the case trigger_action can't cover, since that one only runs an action sequence already sitting on some existing widget's event. Meant for a client that reads state via list_variables/get_action_log and then decides what to do next — e.g. "read the current COMM1 channel, then send the DCS command to change it" — without first having to create_widget a throwaway button just to attach that action to. Takes the same WidgetAction union create_widget/update_widget accept for a widget event or switch position's own action steps: send-dcs-command, update-state, call-rest, set-windows-audio, play-sound, navigate-subdeck, open-overlay, close-overlay, keypress, or none (\`kind\` selects which). ${DCS_COMMAND_SEMANTICS} ${UPDATE_STATE_SEMANTICS} ${CALL_REST_SEMANTICS} navigate-subdeck/open-overlay/close-overlay have no real triggering client to route their reply to — that reply (if any) comes back in this call's own result instead of visibly affecting anything. play-sound with target 'client' or 'both' has the exact same gap: the client half of it is a sound:play message with nowhere real to go, so it silently lands inertly in this call's own result instead of playing on any device — only target 'server'/'both' actually produces audible sound (on the machine running Boarderoni itself), since that half routes to the desktop editor's own socket regardless of who triggered it. For more than one action — e.g. a press then a release with a real pause in between, like holding a spring-loaded switch — use send_actions instead: pacing that with repeated send_action calls plus your own sleep between them is not equivalent, since the deck (and anything watching it) sees each call as a separate, fully independent event rather than one held gesture.`,
        inputSchema: objectSchema({ deckId: DECK_ID_PROP, action: actionRef.schema }, ['deckId', 'action'], actionRef.definitions)
      },
      handler: async (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        if (!args.action || typeof args.action !== 'object') throw new McpToolError('action is required')
        const replies = await deps.runAction(room, args.action as WidgetAction)
        return textResult({ ok: true, replies })
      }
    },
    {
      tool: {
        name: 'send_actions',
        description:
          `Run a whole sequence of steps against a deck right now, in order — send_action for more than one step. Each step is a delay ({"kind":"delay","id":...,"delayMs":...}), an action ({"kind":"action","id":...,"action":<WidgetAction, see send_action for the union>}), or a condition ({"kind":"condition","id":...,"condition":<expression>,"whenTrue":[...],"whenFalse":[...]}) — the exact SequenceStep union a widget event's own stored sequence is made of (see create_widget/update_widget's \`events\`), run through the same engine: a delay step is a real awaited pause server-side, not something to approximate by pacing separate send_action calls with your own sleep in between. \`id\` on each step only needs to be unique within its own steps array (a fresh uuid is fine) — nothing persists it. Stops at the first step that throws (including inside whichever condition branch was taken) and reports which one in the error, same as a stored sequence failing partway; steps before it already ran and are not undone.`,
        inputSchema: objectSchema(
          { deckId: DECK_ID_PROP, steps: { type: 'array', items: stepRef.schema, minItems: 1 } },
          ['deckId', 'steps'],
          stepRef.definitions
        )
      },
      handler: async (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        if (!Array.isArray(args.steps) || args.steps.length === 0) throw new McpToolError('steps must be a non-empty array')
        const replies = await deps.runActions(room, args.steps as SequenceStep[])
        return textResult({ ok: true, replies })
      }
    },
    {
      tool: {
        name: 'get_action_log',
        description:
          "Get a deck's recent action-log entries — the same messages the desktop editor's own debug panel shows: an action expression's own console.log calls, global action activity (prefixed \"[Global action]\"), and a failed CallRestAction's own error (prefixed \"[Call REST: <target name>]\", or \"[Call REST]\" if the target itself was missing/disabled). Newest last. In-memory only, capped at the last 200 entries (older ones are simply dropped, not persisted to disk) — call this right after trigger_action/evaluate_expression/set_variable to see what actually happened server-side, especially for a CallRestAction failure, which otherwise only reaches the triggering client as an action:error, never the console.",
        inputSchema: objectSchema(
          { deckId: DECK_ID_PROP, limit: { type: 'number', description: 'Max entries to return (most recent). Defaults to 50.' } },
          ['deckId']
        )
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const limit = typeof args.limit === 'number' ? Math.max(1, Math.trunc(args.limit)) : 50
        return textResult(room.actionLog.slice(-limit))
      }
    },
    {
      tool: {
        name: 'create_widget',
        description: `Add a new widget to a deck (or one of its sub-decks). widget.id is generated if omitted. Every *Expr field (colorExpr, borderColorExpr, textExpr, valueExpr, visibleExpr, activeStateExpr, etc.) is an expression — ${EXPRESSION_SEMANTICS} ${LABEL_TEXT_SEMANTICS} ${DCS_COMMAND_SEMANTICS} ${UPDATE_STATE_SEMANTICS} ${CALL_REST_SEMANTICS}`,
        inputSchema: objectSchema(
          { deckId: DECK_ID_PROP, subDeckId: { type: 'string', description: 'Omit for the main deck.' }, widget: widgetRef.schema },
          ['deckId', 'widget'],
          widgetRef.definitions
        )
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const subDeckId = optionalString(args, 'subDeckId') ?? null
        const rawWidget = args.widget
        if (!rawWidget || typeof rawWidget !== 'object') throw new McpToolError('widget is required')
        const widget = { id: randomUUID(), ...(rawWidget as object) } as Widget
        const widgets = [...getSubDeckWidgets(room.dashboard, subDeckId), widget]
        deps.applyDashboardUpdate(room, setSubDeckWidgets(room.dashboard, subDeckId, widgets), true)
        return textResult(widget)
      }
    },
    {
      tool: {
        name: 'update_widget',
        description: `Patch fields on an existing widget by id (works for any field, including *Expr expression fields). Can't change a widget's type. Every *Expr field is an expression — ${EXPRESSION_SEMANTICS} ${LABEL_TEXT_SEMANTICS} ${DCS_COMMAND_SEMANTICS} ${UPDATE_STATE_SEMANTICS} ${CALL_REST_SEMANTICS}`,
        inputSchema: objectSchema(
          { deckId: DECK_ID_PROP, widgetId: { type: 'string' }, patch: { type: 'object', description: 'Partial widget fields to merge in.', additionalProperties: true } },
          ['deckId', 'widgetId', 'patch']
        )
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const widgetId = requireString(args, 'widgetId')
        const patch = args.patch
        if (!patch || typeof patch !== 'object') throw new McpToolError('patch must be an object')
        const existing = findWidgetAnywhere(room.dashboard, widgetId)
        if (!existing) throw new McpToolError(`Unknown widget: ${widgetId}`)
        const patchObj = patch as Record<string, unknown>
        if (typeof patchObj.type === 'string' && patchObj.type !== existing.type) {
          throw new McpToolError("Cannot change a widget's type via update_widget — delete and re-create it instead.")
        }
        const updated = { ...existing, ...patchObj, id: existing.id } as Widget
        const subDeckId = widgetSubDeckId(room.dashboard, widgetId)
        const widgets = getSubDeckWidgets(room.dashboard, subDeckId).map((w) => (w.id === widgetId ? updated : w))
        deps.applyDashboardUpdate(room, setSubDeckWidgets(room.dashboard, subDeckId, widgets), true)
        return textResult(updated)
      }
    },
    {
      tool: {
        name: 'delete_widget',
        description: 'Delete a widget from a deck by id.',
        inputSchema: objectSchema({ deckId: DECK_ID_PROP, widgetId: { type: 'string' } }, ['deckId', 'widgetId'])
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const widgetId = requireString(args, 'widgetId')
        if (!findWidgetAnywhere(room.dashboard, widgetId)) throw new McpToolError(`Unknown widget: ${widgetId}`)
        const subDeckId = widgetSubDeckId(room.dashboard, widgetId)
        const widgets = getSubDeckWidgets(room.dashboard, subDeckId).filter((w) => w.id !== widgetId)
        deps.applyDashboardUpdate(room, setSubDeckWidgets(room.dashboard, subDeckId, widgets), true)
        return textResult({ ok: true })
      }
    },
    {
      tool: {
        name: 'list_global_actions',
        description:
          "List a deck's global actions — deck-wide if/then rules that run in the app itself (not on a connected device) whenever one of their watched variables changes.",
        inputSchema: objectSchema({ deckId: DECK_ID_PROP }, ['deckId'])
      },
      handler: (deps, args) => textResult(requireRoom(deps, args.deckId).dashboard.globalActions ?? [])
    },
    {
      tool: {
        name: 'create_global_action',
        description: `Add a global action to a deck. \`watch\` lists the variable names that re-check the rule (like a useEffect dependency array — a variable the condition reads but that isn't listed here will NOT re-check it). \`trigger: 'change'\` fires only when the condition flips false->true; 'always' fires on every watched change while it's true. globalAction.id is generated if omitted. \`condition\` is an expression — ${EXPRESSION_SEMANTICS}`,
        inputSchema: objectSchema({ deckId: DECK_ID_PROP, globalAction: globalActionRef.schema }, ['deckId', 'globalAction'], globalActionRef.definitions)
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const raw = args.globalAction
        if (!raw || typeof raw !== 'object') throw new McpToolError('globalAction is required')
        const globalAction = { id: randomUUID(), ...(raw as object) } as GlobalAction
        const globalActions = [...(room.dashboard.globalActions ?? []), globalAction]
        deps.applyDashboardUpdate(room, { ...room.dashboard, globalActions }, true)
        return textResult(globalAction)
      }
    },
    {
      tool: {
        name: 'update_global_action',
        description: `Patch fields on an existing global action by id (name, enabled, watch, condition, trigger, steps). \`condition\` is an expression — ${EXPRESSION_SEMANTICS}`,
        inputSchema: objectSchema(
          {
            deckId: DECK_ID_PROP,
            globalActionId: { type: 'string' },
            patch: { type: 'object', description: 'Partial global action fields to merge in.', additionalProperties: true }
          },
          ['deckId', 'globalActionId', 'patch']
        )
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const globalActionId = requireString(args, 'globalActionId')
        const patch = args.patch
        if (!patch || typeof patch !== 'object') throw new McpToolError('patch must be an object')
        const existing = (room.dashboard.globalActions ?? []).find((r) => r.id === globalActionId)
        if (!existing) throw new McpToolError(`Unknown global action: ${globalActionId}`)
        const updated = { ...existing, ...(patch as Record<string, unknown>), id: existing.id } as GlobalAction
        const globalActions = (room.dashboard.globalActions ?? []).map((r) => (r.id === globalActionId ? updated : r))
        deps.applyDashboardUpdate(room, { ...room.dashboard, globalActions }, true)
        return textResult(updated)
      }
    },
    {
      tool: {
        name: 'delete_global_action',
        description: 'Delete a global action from a deck by id.',
        inputSchema: objectSchema({ deckId: DECK_ID_PROP, globalActionId: { type: 'string' } }, ['deckId', 'globalActionId'])
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const globalActionId = requireString(args, 'globalActionId')
        const existing = room.dashboard.globalActions ?? []
        if (!existing.some((r) => r.id === globalActionId)) throw new McpToolError(`Unknown global action: ${globalActionId}`)
        deps.applyDashboardUpdate(room, { ...room.dashboard, globalActions: existing.filter((r) => r.id !== globalActionId) }, true)
        return textResult({ ok: true })
      }
    },
    {
      tool: {
        name: 'list_plugin_types',
        description:
          "List every event-source kind this app supports, whether each is currently enabled app-wide, its mappable `fields` (each entry's `key` is what a mapping's own `field` must match — see create_event_source), and its `config` (each entry's `key` is a valid key inside that kind's own `Plugin.config`, with `type` and a `description` covering defaults/constraints). `dynamicFields: true` means `fields` is empty here because the real list depends on live state, not just the kind — currently only 'dcsbios' (use list_dcs_bios_aircraft/list_dcs_bios_fields instead). `config`, unlike `fields`, is always complete here even for 'dcsbios' — a config key never depends on which aircraft is picked.",
        inputSchema: objectSchema({}, [])
      },
      handler: () => {
        const enabled = getAppSettings().enabledPlugins
        return textResult(
          PLUGIN_TYPES.map((t) => ({
            kind: t.kind,
            label: t.label,
            core: t.core ?? false,
            enabled: enabled.includes(t.kind),
            fields: t.fields,
            dynamicFields: t.dynamicFields ?? false,
            config: t.config ?? []
          }))
        )
      }
    },
    {
      tool: {
        name: 'list_windows_audio_devices',
        description:
          "List Windows audio output devices currently visible to the OS — for picking a windowsAudio event source's `config.deviceName`, or a SetWindowsAudioAction widget action's target device. `isDefault` marks whichever device is currently the system default; a mapping's own `config.deviceName: ''` tracks that device dynamically across a default-device change rather than naming one explicitly.",
        inputSchema: objectSchema({}, [])
      },
      handler: async () => textResult(await listWindowsAudioDevices())
    },
    {
      tool: {
        name: 'list_displays',
        description:
          "List every monitor currently connected — for picking a screenCapture event source's (or screen-capture widget's) `config.displayId`/`region`. `bounds` is that display's full virtual-desktop pixel rectangle; pass it as-is for `region` to capture the whole monitor. A sub-region within a display can't be picked from here (there's no way to see the screen through this tool) — that still needs the app's own region-picker overlay.",
        inputSchema: objectSchema({}, [])
      },
      handler: () => textResult(listDisplays())
    },
    {
      tool: {
        name: 'list_dcs_bios_aircraft',
        description:
          "List DCS-BIOS aircraft modules installed on this machine — for picking a dcsbios event source's `config.aircraft`. Call this first; both list_dcs_bios_fields and list_dcs_bios_commands need a valid aircraft id from here, and guessing one is unreliable (aircraft ids are DCS-BIOS's own module folder names, not the aircraft's display name).",
        inputSchema: objectSchema({}, [])
      },
      handler: async () => textResult(await listInstalledAircraft())
    },
    {
      tool: {
        name: 'list_dcs_bios_fields',
        description:
          "List every DCS-BIOS output field for one aircraft (get an `aircraft` id from list_dcs_bios_aircraft first). Each entry's `key` is exactly what a dcsbios event source mapping's own `field` must match (see create_event_source/update_event_source); `label`/`category` describe what it means, `valueType`/`maxValue` describe its range. Use this instead of guessing a control identifier — DCS-BIOS names are terse (e.g. `UFC_COMM1_CHANNEL_SEL`) and aircraft-specific.",
        inputSchema: objectSchema({ aircraft: { type: 'string', description: 'An aircraft id from list_dcs_bios_aircraft.' } }, ['aircraft'])
      },
      handler: async (deps, args) => textResult(await getFieldCatalog(requireString(args, 'aircraft')))
    },
    {
      tool: {
        name: 'list_dcs_bios_commands',
        description:
          "List every DCS-BIOS input command for one aircraft (get an `aircraft` id from list_dcs_bios_aircraft first). Each entry is one (identifier, interface) pair a widget's SendDcsCommandAction can target — the same information the editor's own DCS-BIOS field browser shows. Use this instead of guessing an identifier/interface/argument combination. For `set_state` entries, `label` is DCS-BIOS's own free-text description (e.g. \"Battery Switch, ON/OFF/ORIDE\") and does NOT promise its word order matches ascending state values — `0` is not necessarily the first word. There is no per-value name mapping in this data; confirm which integer means which position by sending each value and observing the aircraft, not by reading the label left to right.",
        inputSchema: objectSchema({ aircraft: { type: 'string', description: 'An aircraft id from list_dcs_bios_aircraft.' } }, ['aircraft'])
      },
      handler: async (deps, args) => textResult(await getCommandCatalog(requireString(args, 'aircraft')))
    },
    {
      tool: {
        name: 'list_rest_webhook_targets',
        description:
          "List every configured REST webhook target — app-wide, not per-deck (see RestWebhookTargetsSettingsPanel), the outgoing counterpart of list_rest_data_sources below. `id` is what a widget's CallRestAction.targetId must reference (see create_widget/update_widget); `headers`/`payloadTemplate` may contain {{placeholderName}} tokens the action's own `values` fill in. Use this before setting up a CallRestAction instead of guessing a targetId.",
        inputSchema: objectSchema({}, [])
      },
      handler: () => textResult(getRestWebhookTargets())
    },
    {
      tool: {
        name: 'list_rest_data_sources',
        description:
          "List every configured REST data source — app-wide, not per-deck, the incoming counterpart of list_rest_webhook_targets above. Each is its own inbound HTTP listener (`port`/`bearerToken` — senders POST here with `Authorization: Bearer <bearerToken>`) feeding one deck's Variables (`targetDeckId`) through `mappings` (same {id, field, variableName, expr} shape as a plugin's own PluginMapping, but `field` here is a flattened dot/index path into whatever JSON body the sender posts, e.g. 'data.temperature' — see shared/flattenJson.ts — not a catalog key, since there's no fixed schema to look one up in). `listening`/`listenError` report whether this source's own HTTP listener is actually up right now.",
        inputSchema: objectSchema({}, [])
      },
      handler: () => textResult(getRestDataSources().map((s) => ({ ...s, ...getRestListenStatus(s.id) })))
    },
    {
      tool: {
        name: 'create_rest_data_source',
        description:
          "Create a new REST data source (an inbound HTTP listener) — id/port/bearerToken are generated here (see the returned object). Starts with empty `mappings` and `targetDeckId: ''`; call update_rest_data_source next to point it at a deck and add mappings before anything actually flows. Restarts the app's REST listeners to pick it up immediately.",
        inputSchema: objectSchema({ name: { type: 'string' } }, ['name'])
      },
      handler: (deps, args) => textResult(deps.createRestDataSource(requireString(args, 'name')))
    },
    {
      tool: {
        name: 'update_rest_data_source',
        description:
          "Patch fields on an existing REST data source by id — name, enabled, port, targetDeckId, and/or mappings (each element the same {id, field, variableName, expr} shape list_rest_data_sources describes; id is generated here if omitted from a new mapping). bearerToken can't be changed through this tool — there's no MCP path to rotate it, by design.",
        inputSchema: objectSchema(
          {
            sourceId: { type: 'string' },
            patch: {
              type: 'object',
              description: 'Partial fields to merge in: name, enabled, port, targetDeckId, and/or mappings.',
              additionalProperties: true
            }
          },
          ['sourceId', 'patch']
        )
      },
      handler: (deps, args) => {
        const sourceId = requireString(args, 'sourceId')
        const patch = args.patch
        if (!patch || typeof patch !== 'object') throw new McpToolError('patch must be an object')
        const updated = deps.updateRestDataSource(sourceId, patch as Record<string, unknown>)
        if (!updated) throw new McpToolError(`Unknown REST data source: ${sourceId}`)
        return textResult(updated)
      }
    },
    {
      tool: {
        name: 'set_enabled_plugins',
        description: 'Replace the app-wide list of enabled event-source/plugin kinds. Use list_plugin_types first to see valid kinds.',
        inputSchema: objectSchema({ enabledPlugins: { type: 'array', items: { type: 'string' } } }, ['enabledPlugins'])
      },
      handler: async (deps, args) => {
        const enabledPlugins = args.enabledPlugins
        if (!Array.isArray(enabledPlugins) || !enabledPlugins.every((k) => typeof k === 'string')) {
          throw new McpToolError('enabledPlugins must be an array of strings')
        }
        const settings = await deps.applyAppSettingsPatch({ enabledPlugins: enabledPlugins as string[] })
        return textResult(settings)
      }
    },
    {
      tool: {
        name: 'list_event_sources',
        description: "List a deck's configured event sources (plugin instances) and their variable mappings.",
        inputSchema: objectSchema({ deckId: DECK_ID_PROP }, ['deckId'])
      },
      handler: (deps, args) => textResult(requireRoom(deps, args.deckId).dashboard.plugins ?? [])
    },
    {
      tool: {
        name: 'create_event_source',
        description:
          "Add a new event source (plugin instance) to a deck. plugin.id is generated if omitted. Call list_plugin_types first: each mapping's own `field` must match a key from that plugin `kind`'s own `fields` there (or list_dcs_bios_fields for 'dcsbios', whose fields depend on `config.aircraft` and so aren't listed statically), and each `config` key/type/constraint listed there applies to this plugin instance's own `config` object. A 'windowsAudio' instance's `config.deviceName` should come from list_windows_audio_devices; a 'dcsbios' instance's `config.aircraft` from list_dcs_bios_aircraft; a 'screenCapture' instance's `config.displayId` from list_displays.",
        inputSchema: objectSchema({ deckId: DECK_ID_PROP, plugin: pluginRef.schema }, ['deckId', 'plugin'], pluginRef.definitions)
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const rawPlugin = args.plugin
        if (!rawPlugin || typeof rawPlugin !== 'object') throw new McpToolError('plugin is required')
        const plugin: Plugin = { ...(rawPlugin as Plugin), id: randomUUID(), mappings: (rawPlugin as Partial<Plugin>).mappings ?? [] }
        deps.applyDashboardUpdate(room, { ...room.dashboard, plugins: [...(room.dashboard.plugins ?? []), plugin] }, true)
        return textResult(plugin)
      }
    },
    {
      tool: {
        name: 'update_event_source',
        description:
          "Patch fields on an existing event source by id (e.g. its mappings, or its plugin-specific config). See create_event_source's own description for where a mapping's `field` (and a 'windowsAudio'/'screenCapture' instance's own config values) should come from.",
        inputSchema: objectSchema(
          { deckId: DECK_ID_PROP, pluginId: { type: 'string' }, patch: { type: 'object', additionalProperties: true } },
          ['deckId', 'pluginId', 'patch']
        )
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const pluginId = requireString(args, 'pluginId')
        const patch = args.patch
        if (!patch || typeof patch !== 'object') throw new McpToolError('patch must be an object')
        const existing = (room.dashboard.plugins ?? []).find((p) => p.id === pluginId)
        if (!existing) throw new McpToolError(`Unknown event source: ${pluginId}`)
        const updated = { ...existing, ...(patch as Record<string, unknown>), id: existing.id } as Plugin
        const plugins = (room.dashboard.plugins ?? []).map((p) => (p.id === pluginId ? updated : p))
        deps.applyDashboardUpdate(room, { ...room.dashboard, plugins }, true)
        return textResult(updated)
      }
    },
    {
      tool: {
        name: 'delete_event_source',
        description: 'Delete an event source from a deck by id.',
        inputSchema: objectSchema({ deckId: DECK_ID_PROP, pluginId: { type: 'string' } }, ['deckId', 'pluginId'])
      },
      handler: (deps, args) => {
        const room = requireRoom(deps, args.deckId)
        const pluginId = requireString(args, 'pluginId')
        const plugins = (room.dashboard.plugins ?? []).filter((p) => p.id !== pluginId)
        if (plugins.length === (room.dashboard.plugins ?? []).length) throw new McpToolError(`Unknown event source: ${pluginId}`)
        deps.applyDashboardUpdate(room, { ...room.dashboard, plugins }, true)
        return textResult({ ok: true })
      }
    },
    {
      tool: {
        name: 'screenshot_dashboard',
        description:
          'Capture a screenshot of a deck as currently rendered in the editor window canvas (no palette/properties chrome). Only works if this exact deck is the one currently open in the editor, AND the editor window is not minimized to tray — a hidden window cannot be captured. Call show_editor_window first if unsure.',
        inputSchema: objectSchema({ deckId: DECK_ID_PROP }, ['deckId'])
      },
      handler: async (deps, args) => {
        const deckId = requireString(args, 'deckId')
        const win = requireEditorWindowOnDeck(deps, deckId)
        const image = await captureDashboardScreenshot(win)
        return { content: [{ type: 'image', data: image.data, mimeType: image.mimeType }] }
      }
    },
    {
      tool: {
        name: 'screenshot_widget',
        description:
          "Capture a screenshot cropped to one widget's own bounding box, as currently rendered in the editor window. Only works if this exact deck is the one currently open in the editor, AND the editor window is not minimized to tray — a hidden window cannot be captured. Call show_editor_window first if unsure.",
        inputSchema: objectSchema({ deckId: DECK_ID_PROP, widgetId: { type: 'string' } }, ['deckId', 'widgetId'])
      },
      handler: async (deps, args) => {
        const deckId = requireString(args, 'deckId')
        const widgetId = requireString(args, 'widgetId')
        const win = requireEditorWindowOnDeck(deps, deckId)
        const room = requireRoom(deps, deckId)
        if (!findWidgetAnywhere(room.dashboard, widgetId)) throw new McpToolError(`Unknown widget: ${widgetId}`)
        // captureWidgetScreenshot measures the widget's own real rendered
        // DOM position (data-widget-id) rather than recomputing one from
        // x/y/w/h — correct regardless of the editor's current pan/zoom,
        // and regardless of which sub-deck view is currently showing (if
        // the widget isn't part of whatever's on screen right now, its
        // element simply isn't found — see that function's own error).
        const image = await captureWidgetScreenshot(win, widgetId)
        return { content: [{ type: 'image', data: image.data, mimeType: image.mimeType }] }
      }
    },
    {
      tool: {
        name: 'show_editor_window',
        description:
          'Show/restore/focus the desktop editor window (creating it if the app has none open yet) — the same thing double-clicking the tray icon does. Needed before screenshot_dashboard/screenshot_widget will work if the window is currently minimized to tray.',
        inputSchema: objectSchema({}, [])
      },
      handler: (deps) => {
        deps.showEditorWindow()
        return textResult({ ok: true })
      }
    },
    {
      tool: {
        name: 'hide_editor_window',
        description:
          "Minimize the desktop editor window to the system tray — the same thing clicking the window's own close (X) button does. The server and any connected deployed views keep running; this only hides the desktop UI. Screenshot tools will fail until show_editor_window is called again.",
        inputSchema: objectSchema({}, [])
      },
      handler: (deps) => {
        deps.hideEditorWindow()
        return textResult({ ok: true })
      }
    }
  ]
}

export function createMcpTools(deps: McpDeps): { tools: Tool[]; callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult> } {
  const defs = buildTools()
  const byName = new Map(defs.map((d) => [d.tool.name, d]))
  return {
    tools: defs.map((d) => d.tool),
    callTool: async (name, args) => {
      const def = byName.get(name)
      if (!def) return errorResult(`Unknown tool: ${name}`)
      try {
        return await def.handler(deps, args)
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  }
}
