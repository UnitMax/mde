import { useEffect, useRef } from 'react'
import { defaultKeymap } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { languageForPath } from '@/lib/code-languages'

const viewerTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      color: 'var(--color-fg)',
      backgroundColor: 'var(--color-bg)',
      fontSize: '12px'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: 'var(--color-fg)', padding: '8px 0' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-bg)',
      color: 'var(--color-fg-subtle)',
      border: 'none',
      paddingRight: '4px'
    },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-hover) 70%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-fg-muted)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent) !important'
    },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' },
    '.cm-searchMatch': {
      backgroundColor: 'color-mix(in srgb, var(--color-warn) 30%, transparent)',
      outline: '1px solid color-mix(in srgb, var(--color-warn) 60%, transparent)'
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--color-warn) 55%, transparent)'
    },
    '.cm-panels': {
      backgroundColor: 'var(--color-panel)',
      color: 'var(--color-fg)',
      borderColor: 'var(--color-line)'
    },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-line)' },
    '.cm-panel.cm-search': { padding: '6px 8px', fontSize: '12px' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': {
      fontSize: '12px',
      color: 'var(--color-fg)',
      backgroundColor: 'var(--color-elevated)',
      backgroundImage: 'none',
      border: '1px solid var(--color-line-strong)',
      borderRadius: '4px'
    },
    '.cm-panel.cm-search label': { color: 'var(--color-fg-muted)' },
    '.cm-panel.cm-search [name=close]': { color: 'var(--color-fg-muted)' }
  },
  { dark: true }
)

const viewerHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: 'var(--color-syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--color-syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--color-syntax-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--color-fg-subtle)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--color-syntax-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--color-syntax-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--color-syntax-property)' },
  { tag: [tags.tagName, tags.heading], color: 'var(--color-accent)', fontWeight: '600' },
  { tag: [tags.definition(tags.variableName), tags.variableName], color: 'var(--color-fg)' },
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--color-fg-muted)' },
  { tag: tags.link, color: 'var(--color-accent)', textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.invalid, color: 'var(--color-danger)' }
])

interface CodeViewerProps {
  /** File path relative to the session root, used to pick the syntax. */
  path: string
  content: string
}

export function CodeViewer({ path, content }: CodeViewerProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageRef = useRef(new Compartment())

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: '',
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          // Keeps the content focusable and selectable although it is not editable.
          EditorView.contentAttributes.of({ tabindex: '0' }),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          highlightSelectionMatches(),
          search({ top: true }),
          keymap.of([...searchKeymap, ...defaultKeymap]),
          viewerTheme,
          syntaxHighlighting(viewerHighlight),
          languageRef.current.of([])
        ]
      })
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
  }, [content])

  useEffect(() => {
    let cancelled = false
    const language = languageForPath(path)
    const view = viewRef.current
    if (!view) return
    if (!language) {
      view.dispatch({ effects: languageRef.current.reconfigure([]) })
      return
    }
    void language.load().then((extension) => {
      if (cancelled || viewRef.current !== view) return
      view.dispatch({ effects: languageRef.current.reconfigure(extension) })
    })
    return () => {
      cancelled = true
    }
  }, [path])

  return <div ref={hostRef} data-testid="code-viewer" className="h-full min-h-0" />
}
