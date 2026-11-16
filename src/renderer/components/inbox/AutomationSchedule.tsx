import { useEffect, useState } from 'react'
import { CalendarClock, Check, ChevronDown, Play, Settings2, SlidersHorizontal } from 'lucide-react'
import { AUTOMATION_DAY_ORDER, AUTOMATION_PRESETS, automationDayName, nextAutomationRun, type AutomationSchedule } from '@shared/automations'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { barTrigger } from '@/components/inbox/ComposerBar'
import {
  automationPresetId,
  automationScheduleLabel,
  automationTimeLabel,
  formSchedule,
  scheduleForm,
  type IntervalUnit,
  type ScheduleForm,
} from '@/lib/automations'
import { cn } from '@/lib/utils'

const UNITS: IntervalUnit[] = ['minutes', 'hours', 'days']
const WEEKDAYS = [1, 2, 3, 4, 5]

const segment = (on: boolean): string => cn(
  'h-7 rounded px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
  on ? 'bg-active text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
)

/** A clock that moves on while a schedule is on screen, so "in 12 minutes" does not go stale. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(timer)
  }, [everyMs])
  return now
}

/**
 * The fields of a schedule: at a time of day on chosen days, or every so often. Under them, what they add up to
 * in words and when that first runs, or what is wrong with them.
 */
export function ScheduleEditor({
  form,
  onChange,
  existing = false,
}: {
  form: ScheduleForm
  onChange: (form: ScheduleForm) => void
  /** The schedule belongs to an automation that has been running: its run is the next one, not the first. */
  existing?: boolean
}): JSX.Element {
  const now = useNow()
  const result = formSchedule(form)
  const toggleDay = (day: number): void =>
    onChange({ ...form, days: form.days.includes(day) ? form.days.filter((item) => item !== day) : [...form.days, day] })
  const everyDay = form.days.length === 0 || form.days.length === 7
  const weekdays = form.days.length === 5 && WEEKDAYS.every((day) => form.days.includes(day))
  return (
    <div className="flex flex-col gap-3" data-testid="automation-schedule-editor">
      <div role="radiogroup" aria-label="Kind of schedule" className="flex w-fit gap-0.5 rounded-md border border-line bg-bg p-0.5">
        <button type="button" role="radio" aria-checked={form.kind === 'daily'} data-testid="automation-kind-daily" className={segment(form.kind === 'daily')} onClick={() => onChange({ ...form, kind: 'daily' })}>
          At a time of day
        </button>
        <button type="button" role="radio" aria-checked={form.kind === 'interval'} data-testid="automation-kind-interval" className={segment(form.kind === 'interval')} onClick={() => onChange({ ...form, kind: 'interval' })}>
          Every so often
        </button>
      </div>
      {form.kind === 'daily' ? (
        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <span className="w-10">At</span>
            <Input
              type="time"
              value={form.time}
              data-testid="automation-time"
              onChange={(event) => onChange({ ...form, time: event.target.value })}
              className="w-36"
            />
          </label>
          <div className="flex items-start gap-2 text-xs text-fg-muted">
            <span className="w-10 pt-1.5">On</span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div role="group" aria-label="Days of the week" className="flex flex-wrap gap-1">
                {AUTOMATION_DAY_ORDER.map((day) => {
                  const on = everyDay || form.days.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={automationDayName(day)}
                      title={automationDayName(day)}
                      data-testid={`automation-day-${day}`}
                      // With every day on, a click on one means "only this day": turning six off one by one would be a chore.
                      onClick={() => (everyDay ? onChange({ ...form, days: [day] }) : toggleDay(day))}
                      className={cn(
                        'h-7 w-9 rounded border text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                        on ? 'border-accent/60 bg-accent/15 text-fg' : 'border-line text-fg-subtle hover:border-line-strong hover:text-fg',
                      )}
                    >
                      {automationDayName(day).slice(0, 2)}
                    </button>
                  )
                })}
              </div>
              <div className="flex gap-1">
                <button type="button" data-testid="automation-days-all" aria-pressed={everyDay} onClick={() => onChange({ ...form, days: [] })} className={cn('rounded px-1.5 py-0.5 text-[11px] hover:bg-hover hover:text-fg', everyDay ? 'text-fg' : 'text-fg-subtle')}>
                  Every day
                </button>
                <button type="button" data-testid="automation-days-weekdays" aria-pressed={weekdays} onClick={() => onChange({ ...form, days: WEEKDAYS })} className={cn('rounded px-1.5 py-0.5 text-[11px] hover:bg-hover hover:text-fg', weekdays ? 'text-fg' : 'text-fg-subtle')}>
                  Weekdays
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="w-10">Every</span>
          <Input
            inputMode="numeric"
            value={form.amount}
            aria-label="How often"
            data-testid="automation-amount"
            onChange={(event) => onChange({ ...form, amount: event.target.value.replace(/[^\d]/g, '').slice(0, 5) })}
            className="w-16 text-center tabular-nums"
          />
          <div role="radiogroup" aria-label="Unit" className="flex gap-0.5 rounded-md border border-line bg-bg p-0.5">
            {UNITS.map((unit) => (
              <button key={unit} type="button" role="radio" aria-checked={form.unit === unit} data-testid={`automation-unit-${unit}`} className={segment(form.unit === unit)} onClick={() => onChange({ ...form, unit })}>
                {unit}
              </button>
            ))}
          </div>
        </div>
      )}
      {'problem' in result ? (
        <p role="alert" data-testid="automation-schedule-problem" className="text-xs text-danger">{result.problem}</p>
      ) : (
        <p data-testid="automation-schedule-summary" className="flex items-center gap-1.5 text-xs text-fg-muted">
          <CalendarClock aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span>
            <span className="text-fg">{automationScheduleLabel(result.schedule)}</span>
            {existing ? ' · next run ' : ' · first run '}
            {automationTimeLabel(nextAutomationRun(result.schedule, now), now)}
          </span>
        </p>
      )}
    </div>
  )
}

/** The dialog that makes a schedule none of the presets is. */
export function CustomScheduleDialog({
  open,
  onOpenChange,
  value,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: AutomationSchedule | null
  onChoose: (schedule: AutomationSchedule) => void
}): JSX.Element {
  const [form, setForm] = useState<ScheduleForm>(() => scheduleForm(value))
  // Each opening starts from what is chosen now.
  useEffect(() => {
    if (open) setForm(scheduleForm(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const result = formSchedule(form)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="automation-custom-dialog">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if ('problem' in result) return
            onChoose(result.schedule)
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>Custom schedule</DialogTitle>
            <DialogDescription>Every run starts a new thread with the same message.</DialogDescription>
          </DialogHeader>
          <ScheduleEditor form={form} onChange={setForm} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={'problem' in result} data-testid="automation-custom-apply">Use this schedule</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Whether the new thread is started once, now, or again and again as an automation: a chip in the strip under the
 * message box, like the one that says how the thread is shown. With a schedule chosen the chip names it and takes
 * the accent color, since the box then saves an automation instead of starting a thread.
 */
export function AutomationPicker({
  value,
  onChange,
  count,
  onManage,
}: {
  value: AutomationSchedule | null
  onChange: (schedule: AutomationSchedule | null) => void
  /** How many automations there are, for the way to them at the foot of the menu. */
  count: number
  onManage: () => void
}): JSX.Element {
  const [custom, setCustom] = useState(false)
  const preset = value ? automationPresetId(value) : null
  const isCustom = value !== null && preset === null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(barTrigger, value && 'bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent data-[state=open]:bg-accent/15 data-[state=open]:text-accent')}
            aria-label={value ? `Automation: ${automationScheduleLabel(value)}` : 'When to run: once, now'}
            title={value ? 'Runs again and again as an automation' : 'Run once, or repeat as an automation'}
            data-testid="automation-picker"
            data-scheduled={value ? '' : undefined}
          >
            {value ? <CalendarClock aria-hidden className="h-3.5 w-3.5 shrink-0" /> : <Play aria-hidden className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{value ? automationScheduleLabel(value) : 'Run once'}</span>
            <ChevronDown aria-hidden className="h-3 w-3 shrink-0 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={() => onChange(null)} className="items-start" data-testid="automation-once">
            <Play aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1">
              <span className="block">Run once</span>
              <span className="block text-[11px] text-fg-subtle">Start the thread now.</span>
            </span>
            {value === null && <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Repeat as an automation</DropdownMenuLabel>
          {AUTOMATION_PRESETS.map(({ id, schedule }) => (
            <DropdownMenuItem key={id} onSelect={() => onChange(schedule)} data-testid={`automation-preset-${id}`}>
              <CalendarClock aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1 truncate">{automationScheduleLabel(schedule)}</span>
              {preset === id && <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setCustom(true)} data-testid="automation-custom">
            <SlidersHorizontal aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate">{isCustom ? `Custom: ${automationScheduleLabel(value)}` : 'Custom…'}</span>
            {isCustom && <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onManage} data-testid="automation-manage">
            <Settings2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate">Manage automations…</span>
            {count > 0 && <span className="text-[11px] tabular-nums text-fg-subtle">{count}</span>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomScheduleDialog open={custom} onOpenChange={setCustom} value={value} onChoose={onChange} />
    </>
  )
}
