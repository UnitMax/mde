import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'

/** Extensions shared by the To Do description editor and the Markdown preview. */
export const markdownExtensions = [
  StarterKit.configure({
    link: {
      openOnClick: false,
    },
  }),
  TableKit,
  Markdown.configure({
    markedOptions: {
      gfm: true,
    },
  }),
]

/** The preview also renders GitHub task lists (`- [ ] item`). */
export const markdownPreviewExtensions = [
  ...markdownExtensions,
  TaskList,
  TaskItem.configure({ nested: true }),
]
