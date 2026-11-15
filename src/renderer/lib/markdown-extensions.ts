import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { MathBlock, MathInline } from '@/lib/math-markdown'
import { MermaidCodeBlock } from '@/lib/mermaid-code-block'

const starterKitOptions = { link: { openOnClick: false } }

/**
 * Read-only Markdown also keeps links to files written as `file://…` or `C:\…`, which a chat reply uses to name a
 * file of the project. They are only ever opened in MDE's own viewer: a click on a link that is not http(s) never
 * leaves the app.
 */
const previewLinkOptions = {
  openOnClick: false,
  isAllowedUri: (url: string, context: { defaultValidate: (url: string) => boolean }) =>
    context.defaultValidate(url) || /^file:\/\//i.test(url) || /^[a-z]:[\\/]/i.test(url),
}

const sharedMarkdownExtensions = [
  TableKit,
  Markdown.configure({
    markedOptions: {
      gfm: true,
    },
  }),
]

/** Extensions shared by the To Do description editor and the Markdown preview. */
export const markdownExtensions = [
  StarterKit.configure(starterKitOptions),
  ...sharedMarkdownExtensions,
]

/**
 * The preview also renders Mermaid diagrams, LaTeX math and GitHub task lists. It is read-only, so it has no use for the
 * editor's trailing empty paragraph, which is there to give the cursor somewhere to go after a list, code block
 * or table. It is only added on the first transaction, and a click is one: the text of a message ending in a
 * list then grew by a blank line the moment it was clicked.
 */
export const markdownPreviewExtensions = [
  StarterKit.configure({ link: previewLinkOptions, codeBlock: false, trailingNode: false }),
  ...sharedMarkdownExtensions,
  MermaidCodeBlock,
  MathBlock,
  MathInline,
  TaskList,
  TaskItem.configure({ nested: true }),
]
