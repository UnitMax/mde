import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { ClipboardPaste, Copy, Scissors, TextSelect } from 'lucide-react'
import { selectAll, standardKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { commonmarkLanguage, deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { Annotation, Compartment, EditorState, Prec, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, placeholder as editorPlaceholder, type DecorationSet } from '@codemirror/view'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { quoteLines } from '@/lib/chat-quote'
import { cleanPromptText } from '@shared/prompt-text'

const externalChange = Annotation.define<boolean>()
const continueList = insertNewlineContinueMarkupCommand({ nonTightLists: false })

class Bullet extends WidgetType {
  override eq(): boolean { return true }

  toDOM(): HTMLElement {
    const bullet = document.createElement('span')
    bullet.className = 'chat-input-bullet'
    bullet.textContent = '•'
    bullet.setAttribute('aria-hidden', 'true')
    return bullet
  }
}

/** Decorate only real Markdown list markers; code, HTML and other text stay literal. */
function bullets(state: EditorState): DecorationSet {
  const ranges: ReturnType<Decoration['range']>[] = []
  syntaxTree(state).iterate({
    enter: ({ name, from, to, node }) => {
      if (name !== 'ListMark' || node.parent?.parent?.name !== 'BulletList') return
      const line = state.doc.lineAt(from)
      ranges.push(Decoration.line({ class: 'chat-input-list-line' }).range(line.from))
      ranges.push(Decoration.replace({ widget: new Bullet() }).range(from, to))
    },
  })
  return Decoration.set(ranges, true)
}

const bulletField = StateField.define<DecorationSet>({
  create: bullets,
  update: (value, transaction) => transaction.docChanged || syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ? bullets(transaction.state) : value,
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
})

/** Quoted lines (`> ` before the text): a bar beside the line, and the mark itself set back. Code fences are left alone. */
function quotes(state: EditorState): DecorationSet {
  const ranges: ReturnType<Decoration['range']>[] = []
  for (const line of quoteLines(state.doc.toString())) {
    ranges.push(Decoration.line({ class: 'chat-input-quote-line' }).range(line.from))
    if (line.markEnd > line.from) ranges.push(Decoration.mark({ class: 'chat-input-quote-mark' }).range(line.from, line.markEnd))
  }
  return Decoration.set(ranges, true)
}

const quoteField = StateField.define<DecorationSet>({
  create: quotes,
  update: (value, transaction) => (transaction.docChanged ? quotes(transaction.state) : value),
  provide: (field) => EditorView.decorations.from(field),
})

/** Asks the command mark to be worked out again for text that did not change, when the commands did. */
const refreshCommandToken = StateEffect.define<null>()

/** The name of a command the message starts with, marked so that the text can be seen to be a command. */
function commandMarks(state: EditorState, token: ChatInputProps['commandToken']): DecorationSet {
  const range = token?.(state.doc.toString())
  if (!range || range.to <= range.from || range.to > state.doc.length) return Decoration.none
  return Decoration.set([Decoration.mark({ class: 'chat-input-command' }).range(range.from, range.to)])
}

/** Asks the file marks to be worked out again for text that did not change, when what is known of the files did. */
const refreshFileMarks = StateEffect.define<null>()

/** The files and folders the message names, marked so that the text can be seen to attach them. */
function fileMarks(state: EditorState, ranges: ChatInputProps['mentionRanges']): DecorationSet {
  const found = (ranges?.(state.doc.toString()) ?? []).filter((range) => range.to > range.from && range.to <= state.doc.length)
  return found.length ? Decoration.set(found.map((range) => Decoration.mark({ class: 'chat-input-file' }).range(range.from, range.to)), true) : Decoration.none
}

const inputTheme = EditorView.theme({
  '&': { color: 'var(--color-fg)', fontSize: '14px', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { maxHeight: '240px', fontFamily: 'inherit', lineHeight: '1.625' },
  '.cm-content': { minHeight: '4.5rem', padding: '12px 16px 0', caretColor: 'var(--color-fg)', userSelect: 'text' },
  '.cm-line': { padding: '0' },
  '.cm-line.chat-input-list-line': { paddingLeft: '1.25em', textIndent: '-1.25em' },
  '.chat-input-bullet': { display: 'inline-block', width: '1em', textAlign: 'center', textIndent: '0' },
  '.cm-line.chat-input-quote-line': {
    paddingLeft: '10px',
    color: 'var(--color-fg-muted)',
    borderLeft: '2px solid color-mix(in srgb, var(--color-accent) 60%, transparent)',
  },
  '.chat-input-quote-mark': { color: 'var(--color-fg-subtle)' },
  '.chat-input-file': {
    color: 'var(--color-accent)',
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
    borderRadius: '4px',
  },
  '.chat-input-command': {
    color: 'var(--color-accent)',
    fontWeight: '500',
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
    borderRadius: '4px',
  },
  '.cm-placeholder': { color: 'var(--color-fg-subtle)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--color-active)' },
})

function inBulletList(state: EditorState): boolean {
  let node = syntaxTree(state).resolveInner(state.selection.main.head, -1)
  while (node.parent) {
    if (node.name === 'BulletList') return true
    node = node.parent
  }
  return false
}

export interface ChatInputHandle {
  focus: (caret?: number) => void
  insertNewline: () => void
}

interface ChatInputProps {
  value: string
  disabled: boolean
  placeholder: string
  autoFocus: boolean
  controls?: string
  activeDescendant?: string
  onChange: (text: string, caret: number) => void
  onSelect: (text: string, caret: number) => void
  onKeyDown: (event: KeyboardEvent) => void
  onPaste: (event: ClipboardEvent) => void
  /** The most text the box takes from typing, pasting or dropping; an edit that would go past it is refused. */
  maxLength?: number
  /** An edit was refused for going past `maxLength`. */
  onTooLong?: () => void
  /**
   * Where the text starts with the name of a command, if it does. That part is shown as a command. The
   * function is read as the text changes, and again when a different one is given.
   */
  commandToken?: (text: string) => { from: number; to: number } | null
  /** The parts of the text that name a file or folder of the project; they are marked. Read like `commandToken`. */
  mentionRanges?: (text: string) => { from: number; to: number }[]
}

/** Markdown remains plain text, with bullet markers displayed as bullets while editing. */
export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(props, ref): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const latest = useRef(props)
  latest.current = props
  const config = useRef(new Compartment())
  // What was selected when the menu opened, which decides which of its items can be used.
  const [selected, setSelected] = useState(false)
  // Paste waits for the menu to close: the editor has to have the focus when the clipboard arrives.
  const pasteAfterClose = useRef(false)

  useLayoutEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          commonmarkLanguage,
          bulletField,
          quoteField,
          StateField.define<DecorationSet>({
            create: (state) => commandMarks(state, latest.current.commandToken),
            update: (value, transaction) =>
              transaction.docChanged || transaction.effects.some((effect) => effect.is(refreshCommandToken))
                ? commandMarks(transaction.state, latest.current.commandToken)
                : value,
            provide: (field) => EditorView.decorations.from(field),
          }),
          StateField.define<DecorationSet>({
            create: (state) => fileMarks(state, latest.current.mentionRanges),
            update: (value, transaction) =>
              transaction.docChanged || transaction.effects.some((effect) => effect.is(refreshFileMarks))
                ? fileMarks(transaction.state, latest.current.mentionRanges)
                : value,
            provide: (field) => EditorView.decorations.from(field),
          }),
          history(),
          // What is dropped in is cleaned as the paste handler below cleans what is pasted.
          EditorView.clipboardInputFilter.of((text) => cleanPromptText(text)),
          // Text that would make the message longer than it may be is refused whole, not cut.
          EditorState.transactionFilter.of((transaction) => {
            const limit = latest.current.maxLength
            if (limit === undefined || !transaction.docChanged || !transaction.isUserEvent('input')) return transaction
            if (transaction.newDoc.length <= limit || transaction.newDoc.length <= transaction.startState.doc.length) return transaction
            queueMicrotask(() => latest.current.onTooLong?.())
            return []
          }),
          keymap.of([{ key: 'Backspace', run: deleteMarkupBackward }, ...standardKeymap.filter((binding) => binding.key !== 'Enter'), ...historyKeymap]),
          EditorView.lineWrapping,
          inputTheme,
          config.current.of([]),
          Prec.highest(EditorView.domEventHandlers({
            keydown: (event) => {
              if (latest.current.disabled) return false
              latest.current.onKeyDown(event)
              return event.defaultPrevented
            },
            paste: (event, editor) => {
              if (latest.current.disabled) return true
              latest.current.onPaste(event)
              if (event.defaultPrevented) return true
              if (!event.clipboardData) return false
              // Ignore text/html even when the clipboard supplies it alongside plain text. Terminal output (CI logs)
              // brings colour codes and other control characters, which a message must not hold.
              const pasted = cleanPromptText(event.clipboardData.getData('text/plain'))
              editor.dispatch(editor.state.replaceSelection(pasted), { userEvent: 'input.paste', scrollIntoView: true })
              return true
            },
          })),
          EditorView.updateListener.of((update) => {
            if (update.transactions.some((transaction) => transaction.annotation(externalChange))) return
            const selection = update.state.selection.main
            const caret = selection.empty ? selection.head : -1
            if (update.docChanged) latest.current.onChange(update.state.doc.toString(), caret)
            else if (update.selectionSet) latest.current.onSelect(update.state.doc.toString(), caret)
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [])

  useLayoutEffect(() => {
    const view = viewRef.current!
    const attributes: Record<string, string> = {
      'aria-label': 'Message',
      'aria-multiline': 'true',
      'aria-disabled': String(props.disabled),
      spellcheck: 'false',
    }
    if (props.controls) attributes['aria-controls'] = props.controls
    if (props.activeDescendant) attributes['aria-activedescendant'] = props.activeDescendant
    view.dispatch({ effects: config.current.reconfigure([
      EditorState.readOnly.of(props.disabled),
      EditorView.editable.of(!props.disabled),
      EditorView.contentAttributes.of(attributes),
      editorPlaceholder(props.placeholder),
    ]) })
  }, [props.disabled, props.placeholder, props.controls, props.activeDescendant])

  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: refreshCommandToken.of(null) })
  }, [props.commandToken])

  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: refreshFileMarks.of(null) })
  }, [props.mentionRanges])

  useLayoutEffect(() => {
    const view = viewRef.current!
    if (props.value === view.state.doc.toString()) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: props.value },
      selection: { anchor: Math.min(view.state.selection.main.head, props.value.length) },
      annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
    })
  }, [props.value])

  useEffect(() => {
    if (props.autoFocus && !props.disabled) viewRef.current?.focus()
  }, [props.autoFocus, props.disabled])

  useImperativeHandle(ref, () => ({
    focus: (caret) => {
      const view = viewRef.current
      if (!view || view.state.readOnly) return
      if (caret !== undefined) view.dispatch({ selection: { anchor: Math.min(caret, view.state.doc.length) }, scrollIntoView: true })
      view.focus()
    },
    insertNewline: () => {
      const view = viewRef.current
      if (!view || view.state.readOnly) return
      if (inBulletList(view.state) && continueList(view)) return
      view.dispatch(view.state.replaceSelection('\n'), { scrollIntoView: true, userEvent: 'input' })
    },
  }), [])

  const selectedText = (): string => {
    const view = viewRef.current
    if (!view) return ''
    const { from, to } = view.state.selection.main
    return view.state.sliceDoc(from, to)
  }
  // The page may not write the clipboard itself; the main process does. A failure leaves the clipboard as it was.
  const copyToClipboard = (text: string): Promise<boolean> =>
    window.api.clipboard.writeText(text).then(
      () => true,
      () => false,
    )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenuCapture={() => setSelected(selectedText() !== '')}>
        <div ref={hostRef} data-testid="chat-input" />
      </ContextMenuTrigger>
      <ContextMenuContent
        data-testid="chat-input-menu"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          viewRef.current?.focus()
          if (pasteAfterClose.current) {
            pasteAfterClose.current = false
            void window.api.clipboard.paste().catch(() => undefined)
          }
        }}
      >
        <ContextMenuItem
          data-testid="chat-input-menu-cut"
          disabled={props.disabled || !selected}
          onSelect={() => {
            const view = viewRef.current
            const text = selectedText()
            if (!view || !text) return
            // The text is removed only once it is safely on the clipboard.
            void copyToClipboard(text).then((copied) => {
              if (!copied) return
              const { from, to } = view.state.selection.main
              if (view.state.sliceDoc(from, to) === text) view.dispatch({ changes: { from, to, insert: '' }, userEvent: 'delete.cut', scrollIntoView: true })
            })
          }}
        >
          <Scissors aria-hidden className="h-3.5 w-3.5" />
          Cut
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="chat-input-menu-copy"
          disabled={!selected}
          onSelect={() => {
            const text = selectedText()
            if (text) void copyToClipboard(text)
          }}
        >
          <Copy aria-hidden className="h-3.5 w-3.5" />
          Copy
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="chat-input-menu-paste"
          disabled={props.disabled}
          onSelect={() => {
            pasteAfterClose.current = true
          }}
        >
          <ClipboardPaste aria-hidden className="h-3.5 w-3.5" />
          Paste
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-testid="chat-input-menu-select-all"
          onSelect={() => {
            const view = viewRef.current
            if (view) selectAll(view)
          }}
        >
          <TextSelect aria-hidden className="h-3.5 w-3.5" />
          Select all
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
