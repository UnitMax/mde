import { useEffect, useRef } from 'react'
import { defaultKeymap, selectAll } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { languageForPath } from '@/lib/code-languages'
import { SYNTAX_STYLE } from '@/lib/syntax-style'
import { FilePreviewMenu } from '@/components/FilePreviewMenu'
import {
  codeViewerFontFamily,
  getTerminalSettings,
  subscribeTerminalSettings
} from '@/terminal/terminal-settings'
import { getThemeMode } from '@/theme/themes'

function fontTheme(family: string): Extension {
  return EditorView.theme({ '.cm-scroller': { fontFamily: codeViewerFontFamily(family) } })
}

/** Its colors are theme variables; `dark` only picks which of CodeMirror's own light or dark base rules apply. */
const viewerTheme = (dark: boolean): Extension => EditorView.theme(
  {
    '&': {
      height: '100%',
      color: 'var(--color-fg)',
      backgroundColor: 'var(--color-bg)',
      fontSize: '12px'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { lineHeight: '1.55' },
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
  { dark }
)

const viewerHighlight = HighlightStyle.define([...SYNTAX_STYLE])

interface CodeViewerProps {
  /** File path relative to the session root, used to pick the syntax. */
  path: string
  content: string
}

export function CodeViewer({ path, content }: CodeViewerProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageRef = useRef(new Compartment())
  const fontRef = useRef(new Compartment())
  const modeRef = useRef(new Compartment())

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let family = getTerminalSettings().codeFamily
    let dark = getThemeMode(getTerminalSettings().theme) === 'dark'
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
          modeRef.current.of(viewerTheme(dark)),
          fontRef.current.of(fontTheme(family)),
          syntaxHighlighting(viewerHighlight),
          languageRef.current.of([])
        ]
      })
    })
    viewRef.current = view
    const unsubscribe = subscribeTerminalSettings(() => {
      const settings = getTerminalSettings()
      if (settings.codeFamily !== family) {
        family = settings.codeFamily
        view.dispatch({ effects: fontRef.current.reconfigure(fontTheme(family)) })
      }
      const nextDark = getThemeMode(settings.theme) === 'dark'
      if (nextDark !== dark) {
        dark = nextDark
        view.dispatch({ effects: modeRef.current.reconfigure(viewerTheme(dark)) })
      }
    })
    return () => {
      unsubscribe()
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

  return (
    <FilePreviewMenu
      empty={content.length === 0}
      getSelectedText={() => {
        const view = viewRef.current
        if (!view) return ''
        const { from, to } = view.state.selection.main
        return view.state.sliceDoc(from, to)
      }}
      onSelectAll={() => {
        const view = viewRef.current
        if (view) selectAll(view)
      }}
      onClose={() => viewRef.current?.focus()}
    >
      <div ref={hostRef} data-testid="code-viewer" className="h-full min-h-0" />
    </FilePreviewMenu>
  )
}
