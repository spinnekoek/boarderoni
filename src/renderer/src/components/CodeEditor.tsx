import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorView, keymap, placeholder as placeholderExt, lineNumbers } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// Matches the app's own dark palette (see styles.css) rather than pulling in
// a mismatched community theme.
const highlightStyle = HighlightStyle.define([
  { tag: tags.controlKeyword, color: '#5b8def', fontWeight: 'bold' },
  { tag: tags.keyword, color: '#5b8def' },
  { tag: [tags.string, tags.special(tags.string)], color: '#4caf7d' },
  { tag: [tags.number, tags.bool, tags.null], color: '#e2b93b' },
  { tag: tags.comment, color: '#6b7280', fontStyle: 'italic' },
  { tag: [tags.propertyName, tags.attributeName], color: '#e2793b' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#8b5be2' },
  { tag: [tags.operator, tags.punctuation], color: '#9098a8' },
  { tag: tags.variableName, color: '#e8e8ea' }
])

const theme = EditorView.theme(
  {
    '&': {
      color: '#e8e8ea',
      backgroundColor: '#14161b',
      fontSize: '12px'
    },
    '.cm-content': {
      fontFamily: "'JetBrains Mono', monospace",
      // JetBrains Mono ligature-merges character pairs like "=>"/"!=="/"=="
      // by default — disabled so every character stays visually distinct,
      // which matters more here than the stylistic ligatures do.
      fontVariantLigatures: 'none',
      caretColor: '#e8e8ea',
      padding: '8px 0'
    },
    '.cm-line': { padding: '0 8px' },
    '.cm-cursor': { borderLeftColor: '#e8e8ea' },
    '.cm-activeLine': { backgroundColor: 'rgba(91, 141, 239, 0.06)' },
    '.cm-gutters': { backgroundColor: '#14161b', color: '#4a505e', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(91, 141, 239, 0.06)' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(91, 141, 239, 0.25) !important' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(91, 141, 239, 0.35) !important' },
    '.cm-placeholder': { color: '#4a505e', fontStyle: 'normal' }
  },
  { dark: true }
)

export interface CodeEditorHandle {
  // Commits whatever's currently typed, even if the editor never blurred —
  // ExpressionEditorModal calls this on every one of its own close paths
  // (×, Done, Escape, backdrop click) rather than trusting that closing the
  // modal always fires a natural blur first. A no-op if there's nothing
  // uncommitted (see the `doc === lastCommitted` guard in `commit` below).
  flush: () => void
}

// A CodeMirror-backed JS editor, styled to match the app's dark theme —
// used for colorExpr/borderColorExpr (and, later, the other expression
// fields: label textExpr, morph block colorExpr, the update-state action
// code). `minimal` drops the line-number gutter for small inline fields;
// the expanded modal view uses the fuller (non-minimal) form.
//
// `onChange` fires on BLUR, not per keystroke — every expression field here
// ultimately patches widget state, which round-trips through the dashboard
// store to the main process (persisted to disk, then broadcast back out;
// see updateWidgets in store.ts) on every call, so committing per keystroke
// made typing in an expression field visibly laggy. CodeMirror's own doc
// stays the source of truth for what's on screen while typing either way —
// this only changes when the OUTSIDE world (widget state, and everything
// downstream of it: the live canvas preview, the WS broadcast) hears about
// it.
export const CodeEditor = forwardRef<
  CodeEditorHandle,
  {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    minimal?: boolean
  }
>(function CodeEditor({ value, onChange, placeholder, minimal = false }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastCommittedRef = useRef(value)

  function commit(): void {
    const view = viewRef.current
    if (!view) return
    const doc = view.state.doc.toString()
    if (doc === lastCommittedRef.current) return
    lastCommittedRef.current = doc
    onChangeRef.current(doc)
  }

  useImperativeHandle(ref, () => ({ flush: commit }), [])

  useEffect(() => {
    if (!containerRef.current) return

    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      javascript(),
      syntaxHighlighting(highlightStyle),
      bracketMatching(),
      EditorView.lineWrapping,
      theme,
      EditorView.domEventHandlers({ blur: () => commit() })
    ]
    if (!minimal) extensions.push(lineNumbers())
    if (placeholder) extensions.push(placeholderExt(placeholder))

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: containerRef.current
    })
    viewRef.current = view

    return () => view.destroy()
    // Mount-only — `value` changes on every commit, so re-running this then
    // would tear down and rebuild the editor (losing cursor position/undo
    // history) instead of just typing. External value changes are pushed
    // via the effect below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value changes (e.g. clearing the expression, or switching
  // to a different widget/state) into the editor — but not when the change
  // came from this editor's own commit, in which case `value` already
  // matches the doc and re-dispatching would just disturb the cursor.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    lastCommittedRef.current = value
  }, [value])

  return <div className={`code-editor${minimal ? ' code-editor--minimal' : ' code-editor--expanded'}`} ref={containerRef} />
})
