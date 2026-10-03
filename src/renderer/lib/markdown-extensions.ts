import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { MermaidCodeBlock } from '@/lib/mermaid-code-block'

const starterKitOptions = { link: { openOnClick: false } }

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

/** The preview also renders Mermaid diagrams and GitHub task lists. */
export const markdownPreviewExtensions = [
  StarterKit.configure({ ...starterKitOptions, codeBlock: false }),
  ...sharedMarkdownExtensions,
  MermaidCodeBlock,
  TaskList,
  TaskItem.configure({ nested: true }),
]
