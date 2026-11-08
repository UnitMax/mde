import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  isPermissionEffect,
  LEGACY_PERMISSION_ACTIONS,
  PERMISSION_ACTIONS,
  type PermissionRule,
} from '@shared/opencode-config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

const ACTION_LIST_ID = 'opencode-config-actions'

/** Rules worth a click: each is added at the end, where it wins over the rules before it. */
const QUICK_RULES: Array<{ label: string; rule: PermissionRule }> = [
  { label: 'Ask before shell commands', rule: { action: 'shell', resource: '*', effect: 'ask' } },
  { label: 'Deny git push', rule: { action: 'shell', resource: 'git push *', effect: 'deny' } },
  { label: 'Ask outside the project', rule: { action: 'external_directory', resource: '*', effect: 'ask' } },
]

const same = (a: PermissionRule, b: PermissionRule): boolean =>
  a.action === b.action && a.resource === b.resource && a.effect === b.effect

const EFFECT_LABELS = { allow: 'Allow', ask: 'Ask', deny: 'Deny' } as const

function RuleRow({
  rule,
  index,
  count,
  readOnly,
  onChange,
  onMove,
  onRemove,
}: {
  rule: PermissionRule
  index: number
  count: number
  readOnly: boolean
  onChange: (rule: PermissionRule) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}): JSX.Element {
  const number = index + 1
  const replacement = LEGACY_PERMISSION_ACTIONS[rule.action]
  return (
    <li data-testid="opencode-rule" className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-fg-subtle">{number}</span>
        <Input
          list={ACTION_LIST_ID}
          value={rule.action}
          disabled={readOnly}
          spellCheck={false}
          autoComplete="off"
          placeholder="Action"
          aria-label={`Action of rule ${number}`}
          data-testid="opencode-rule-action"
          className="w-40 shrink-0 font-mono text-xs"
          onChange={(event) => onChange({ ...rule, action: event.target.value })}
        />
        <Input
          value={rule.resource}
          disabled={readOnly}
          spellCheck={false}
          autoComplete="off"
          placeholder="Resource, e.g. git push * (* is anything)"
          aria-label={`Resource of rule ${number}`}
          data-testid="opencode-rule-resource"
          className="min-w-0 flex-1 font-mono text-xs"
          onChange={(event) => onChange({ ...rule, resource: event.target.value })}
        />
        <RadioGroup
          value={rule.effect}
          disabled={readOnly}
          aria-label={`Effect of rule ${number}`}
          data-testid="opencode-rule-effect"
          className="w-40 shrink-0 gap-1"
          onValueChange={(value) => {
            if (isPermissionEffect(value)) onChange({ ...rule, effect: value })
          }}
        >
          {(['allow', 'ask', 'deny'] as const).map((effect) => (
            <RadioGroupItem
              key={effect}
              value={effect}
              data-testid={`opencode-rule-${effect}`}
              aria-label={`${EFFECT_LABELS[effect]} (rule ${number})`}
              className="px-0 text-xs"
            >
              {EFFECT_LABELS[effect]}
            </RadioGroupItem>
          ))}
        </RadioGroup>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={readOnly || index === 0}
          aria-label={`Move rule ${number} up`}
          title="Move up (earlier rules lose to later ones)"
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={readOnly || index === count - 1}
          aria-label={`Move rule ${number} down`}
          title="Move down"
          onClick={() => onMove(1)}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={readOnly}
          aria-label={`Delete rule ${number}`}
          title="Delete"
          className="hover:text-danger"
          data-testid="opencode-rule-delete"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {replacement && (
        <p data-testid="opencode-rule-legacy" className="ml-[1.625rem] flex items-center gap-2 text-[11px] text-warn">
          OpenCode 2 matches “{replacement}”, not “{rule.action}”.
          <button
            type="button"
            disabled={readOnly}
            className="underline underline-offset-2 hover:text-fg disabled:opacity-50"
            onClick={() => onChange({ ...rule, action: replacement })}
          >
            Use {replacement}
          </button>
        </p>
      )}
    </li>
  )
}

/**
 * The ordered permission rules. OpenCode checks every rule against what the agent wants to do and the last one
 * that matches decides; when none matches, it asks.
 */
export function OpenCodeConfigPermissions({
  rules,
  readOnly,
  onChange,
}: {
  rules: PermissionRule[]
  readOnly: boolean
  onChange: (rules: PermissionRule[]) => void
}): JSX.Element {
  const update = (index: number, rule: PermissionRule): void =>
    onChange(rules.map((existing, at) => (at === index ? rule : existing)))
  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    const moved = rules[index]
    const other = rules[target]
    if (!moved || !other) return
    onChange(rules.map((existing, at) => (at === index ? other : at === target ? moved : existing)))
  }

  return (
    <div className="flex flex-col gap-3" data-testid="opencode-permissions">
      <p className="text-xs text-fg-muted">
        When the agent wants to do something, OpenCode checks the rules from first to last. <strong className="font-medium text-fg">The last rule that matches decides</strong>;
        if none matches, it asks. Put general rules first and exceptions after them.
      </p>
      <datalist id={ACTION_LIST_ID}>
        {PERMISSION_ACTIONS.map((action) => (
          <option key={action} value={action} />
        ))}
      </datalist>
      {rules.length === 0 ? (
        <p data-testid="opencode-rules-empty" className="rounded-md border border-dashed border-line px-3 py-5 text-center text-[13px] text-fg-muted">
          No permission rules in the file. OpenCode uses its defaults.
        </p>
      ) : (
        <ol className="flex flex-col gap-2" data-testid="opencode-rule-list">
          {rules.map((rule, index) => (
            <RuleRow
              // Rules have no identity of their own; a row is its place in the list.
              key={index}
              rule={rule}
              index={index}
              count={rules.length}
              readOnly={readOnly}
              onChange={(next) => update(index, next)}
              onMove={(direction) => move(index, direction)}
              onRemove={() => onChange(rules.filter((_, at) => at !== index))}
            />
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          disabled={readOnly}
          data-testid="opencode-rule-add"
          onClick={() => onChange([...rules, { action: '', resource: '*', effect: 'ask' }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add rule
        </Button>
        <span className="ml-2 text-[11px] text-fg-subtle">Quick add:</span>
        {QUICK_RULES.map(({ label, rule }) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            size="sm"
            disabled={readOnly || rules.some((existing) => same(existing, rule))}
            className="text-fg-muted"
            data-testid="opencode-rule-quick"
            onClick={() => onChange([...rules, rule])}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}
