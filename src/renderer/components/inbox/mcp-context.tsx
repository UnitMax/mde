import { createContext } from 'react'

/**
 * The names of the MCP servers OpenCode has for the open thread. A tool call is told apart as a server's from a
 * built-in's by them. The array only changes when the set of names does, so the conversation's messages, which are
 * kept from drawing again when nothing about them changed, do not draw again for it either.
 */
export const McpServerNamesContext = createContext<readonly string[]>([])
