import type { TagStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/**
 * How code is coloured, shared by the file viewer and the chat's diffs so the two always agree.
 * The colors are theme variables, which follow the application theme.
 */
export const SYNTAX_STYLE: readonly TagStyle[] = [
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
]
