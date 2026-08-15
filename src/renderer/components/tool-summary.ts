import type { OpenCodeLiveToolMessage, OpenCodeToolMessage } from '@shared/types'

type ToolMessageLike = Pick<OpenCodeToolMessage, 'tool' | 'input' | 'title'> & {
  rawInput?: string
}

const MAX_DETAIL_LENGTH = 120

function recordValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function parseRawInput(rawInput: string | undefined): Record<string, unknown> {
  if (!rawInput) return {}
  try {
    const parsed: unknown = JSON.parse(rawInput)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function detailValue(message: ToolMessageLike, keys: string[]): string | undefined {
  return recordValue(message.input, keys) ?? recordValue(parseRawInput(message.rawInput), keys)
}

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > MAX_DETAIL_LENGTH ? `${normalized.slice(0, MAX_DETAIL_LENGTH - 1)}…` : normalized
}

function summary(label: string, detail?: string): string {
  return detail ? `${label} · ${compact(detail)}` : label
}

/** Builds a concise description for known OpenCode built-in tools. */
export function describeBuiltInTool(message: OpenCodeToolMessage | OpenCodeLiveToolMessage): string {
  const tool = message.tool.trim().toLowerCase()

  switch (tool) {
    case 'read':
      return summary('Read', detailValue(message, ['filePath', 'path']))
    case 'write':
      return summary('Write', detailValue(message, ['filePath', 'path']))
    case 'edit':
      return summary('Edit', detailValue(message, ['filePath', 'path']))
    case 'bash':
    case 'shell':
    case 'exec':
      return summary('Shell', detailValue(message, ['command', 'cmd']))
    case 'glob':
    case 'find':
      return summary('Find', detailValue(message, ['pattern', 'include', 'path']))
    case 'grep':
    case 'search': {
      const pattern = detailValue(message, ['pattern', 'query'])
      const path = detailValue(message, ['path', 'include'])
      return summary('Search', pattern ? `${pattern}${path ? ` in ${path}` : ''}` : path)
    }
    case 'list':
      return summary('List', detailValue(message, ['path', 'directory']))
    case 'task':
    case 'subagent': {
      const agent = detailValue(message, ['subagent_type', 'subagentType', 'agent'])
      const description = detailValue(message, ['description', 'prompt']) ?? message.title
      return summary('Subagent', [agent, description].filter(Boolean).join(' · ') || undefined)
    }
    case 'webfetch':
      return summary('Fetch', detailValue(message, ['url']))
    default:
      return message.tool
  }
}
