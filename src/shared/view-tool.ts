import { MDE_MCP_SERVER_NAME, MDE_VIEW_TOOL } from './mde-mcp'

/**
 * How a `show_view` call of the MDE MCP looks in OpenCode's transcript: as a direct tool part named
 * `mde_show_view`, or, in Code Mode, as a call `mde.show_view` listed in an `execute` part's metadata.
 */
export const VIEW_TOOL_PART = `${MDE_MCP_SERVER_NAME}_${MDE_VIEW_TOOL}`
export const VIEW_TOOL_CALL = `${MDE_MCP_SERVER_NAME}.${MDE_VIEW_TOOL}`

export function isViewTool(name: string): boolean {
  return name === VIEW_TOOL_PART
}

export function isViewCall(tool: string): boolean {
  return tool === VIEW_TOOL_CALL
}
