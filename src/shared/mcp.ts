/**
 * An MCP server's name as the user wrote it in the OpenCode configuration. It may hold spaces or dots, and it goes
 * into a URL path, so a name made only of dots (`.` or `..`, which a URL would read as a path step) is refused, as
 * are control characters. The OpenCode client, the IPC validator and the list parser all use this one rule.
 */
export const MCP_SERVER_NAME = /^(?!\.+$)[^\u0000-\u001f\u007f-\u009f]{1,200}$/
