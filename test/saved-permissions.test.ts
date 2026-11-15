import { describe, expect, it } from 'vitest'
import { groupSavedPermissions, savedPermissionAction, savedPermissionPattern } from '../src/renderer/lib/saved-permissions'

const saved = (id: string, action: string, resource: string, created = 0) => ({ id, action, resource, created })

describe('saved permissions', () => {
  it('names the usual actions and MCP tools by their server', () => {
    expect(savedPermissionAction('shell')).toEqual({ label: 'Commands', kind: 'shell' })
    expect(savedPermissionAction('external_directory')).toEqual({ label: 'Outside the project', kind: 'outside' })
    // The longest listed server name that fits wins, since a name can hold `_` itself.
    expect(savedPermissionAction('my_docs_search', ['my', 'my_docs'])).toEqual({ label: 'search', kind: 'mcp', server: 'my_docs' })
    expect(savedPermissionAction('opencode_read_mcp_resource')).toEqual({ label: 'MCP resources', kind: 'mcp' })
    expect(savedPermissionAction('custom_tool')).toEqual({ label: 'custom_tool', kind: 'other' })
  })

  it('groups by action, commands and edits before MCP and the rest', () => {
    const groups = groupSavedPermissions([
      saved('psv_1', 'github_create_issue', '*'),
      saved('psv_2', 'skill', 'review'),
      saved('psv_3', 'edit', '*'),
      saved('psv_4', 'shell', 'git status *'),
      saved('psv_5', 'shell', 'npm test *'),
    ], ['github'])
    expect(groups.map((group) => [group.action, group.permissions.map((item) => item.id)])).toEqual([
      ['shell', ['psv_4', 'psv_5']],
      ['edit', ['psv_3']],
      ['github_create_issue', ['psv_1']],
      ['skill', ['psv_2']],
    ])
  })

  it('reads a lone star as anything', () => {
    expect(savedPermissionPattern('*')).toEqual({ text: 'Anything', anything: true })
    expect(savedPermissionPattern('ls *')).toEqual({ text: 'ls *', anything: false })
  })
})
