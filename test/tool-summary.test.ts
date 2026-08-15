import { describe, expect, it } from 'vitest'
import type { OpenCodeToolMessage } from '../src/shared/types'
import { describeBuiltInTool } from '../src/renderer/components/tool-summary'

function tool(toolName: string, input: Record<string, unknown> = {}, extra: Partial<OpenCodeToolMessage> = {}) {
  return {
    id: 'tool-1',
    role: 'tool' as const,
    tool: toolName,
    status: 'completed' as const,
    input,
    ...extra
  }
}

describe('built-in OpenCode tool summaries', () => {
  it('describes file tools with their target path', () => {
    expect(describeBuiltInTool(tool('read', { filePath: 'src/app.ts' }))).toBe('Read · src/app.ts')
    expect(describeBuiltInTool(tool('write', { path: 'test.txt' }))).toBe('Write · test.txt')
    expect(describeBuiltInTool(tool('edit', { filePath: 'src/app.ts' }))).toBe('Edit · src/app.ts')
  })

  it('describes shell, find, and search tools with their query', () => {
    expect(describeBuiltInTool(tool('bash', { command: 'git init' }))).toBe('Shell · git init')
    expect(describeBuiltInTool(tool('find', { pattern: '**/*.tsx' }))).toBe('Find · **/*.tsx')
    expect(describeBuiltInTool(tool('grep', { pattern: 'TODO', path: 'src' }))).toBe('Search · TODO in src')
  })

  it('describes subagents with the selected agent and task', () => {
    expect(
      describeBuiltInTool(tool('task', { subagent_type: 'explore', description: 'Inspect the repository' }))
    ).toBe('Subagent · explore · Inspect the repository')
  })

  it('uses raw input while a tool is still streaming', () => {
    expect(
      describeBuiltInTool({ ...tool('read'), rawInput: '{"filePath":"src/live.ts"}' })
    ).toBe('Read · src/live.ts')
  })

  it('handles missing or malformed details and preserves custom tool names', () => {
    expect(describeBuiltInTool(tool('read'))).toBe('Read')
    expect(describeBuiltInTool({ ...tool('write'), rawInput: 'not json' })).toBe('Write')
    expect(describeBuiltInTool(tool('mcp_custom_tool', { value: 'input' }))).toBe('mcp_custom_tool')
  })

  it('normalizes whitespace and truncates long details', () => {
    const longCommand = `  ${'echo '.repeat(40)}done  `
    const result = describeBuiltInTool(tool('shell', { command: longCommand }))
    expect(result.startsWith('Shell · echo echo')).toBe(true)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(128)
  })
})
