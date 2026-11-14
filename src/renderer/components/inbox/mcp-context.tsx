import { createContext } from 'react'
import type { ChatFileSource } from '@/lib/chat-file-links'

/**
 * The names of the MCP servers OpenCode has for the open thread. A tool call is told apart as a server's from a
 * built-in's by them. The array only changes when the set of names does, so the conversation's messages, which are
 * kept from drawing again when nothing about them changed, do not draw again for it either.
 */
export const McpServerNamesContext = createContext<readonly string[]>([])

/**
 * The open thread's folder, for the files its replies name: a click on one opens it in the file viewer. Null where
 * there is no folder to look in, such as a thread whose worktree was deleted.
 */
export const ChatFileSourceContext = createContext<ChatFileSource | null>(null)
