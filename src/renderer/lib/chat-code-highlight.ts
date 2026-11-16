import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { highlightTree } from '@lezer/highlight'
import { codeHighlighter, codeStyleOf, loadCodeParser, type CodeParser } from '@/lib/code-highlight'
import { languageForFence, type LanguageLoader } from '@/lib/code-languages'

/** Match the diff preview's limit so a huge generated block cannot hold up the conversation. */
const MAX_HIGHLIGHT_CHARS = 200_000

/** Colors only the document's text, so selection, search and copying still see the original code. */
export function chatCodeHighlighting(): Plugin<DecorationSet> {
  const key = new PluginKey<DecorationSet>('chatCodeHighlighting')
  const parsers = new Map<LanguageLoader, CodeParser | null>()
  const pending = new Set<LanguageLoader>()
  let view: EditorView | null = null

  const load = (loader: LanguageLoader): void => {
    if (pending.has(loader)) return
    pending.add(loader)
    void loadCodeParser(loader).then((parser) => {
      parsers.set(loader, parser)
      pending.delete(loader)
      if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true))
    })
  }

  const decorate = (doc: ProseMirrorNode): DecorationSet => {
    const decorations: Decoration[] = []
    doc.descendants((node, position) => {
      if (node.type.name !== 'codeBlock') return
      const language = languageForFence(node.attrs.language ?? '')
      if (!language || node.content.size > MAX_HIGHLIGHT_CHARS) return false
      if (!parsers.has(language.load)) {
        load(language.load)
        return false
      }
      const parser = parsers.get(language.load)
      if (!parser) return false
      try {
        const code = node.textContent
        highlightTree(parser.parse(code), codeHighlighter, (from, to, classes) => {
          const style = codeStyleOf(classes)
          if (!style) return
          // These properties come only from SYNTAX_STYLE, never from the message or the parser.
          const css = Object.entries(style).map(([name, value]) => `${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`).join(';')
          decorations.push(Decoration.inline(position + 1 + from, position + 1 + to, { style: css }))
        })
      } catch {
        // Incomplete or unparseable code remains readable and copyable without colors.
      }
      return false
    })
    return DecorationSet.create(doc, decorations)
  }

  return new Plugin({
    key,
    state: {
      init: (_, state) => decorate(state.doc),
      apply: (transaction, current) => transaction.docChanged || transaction.getMeta(key) ? decorate(transaction.doc) : current,
    },
    props: { decorations: (state) => key.getState(state) },
    view: (editorView) => {
      view = editorView
      return { destroy: () => { view = null } }
    },
  })
}
