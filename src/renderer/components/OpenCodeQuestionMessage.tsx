import { useEffect, useState } from 'react'
import type { OpenCodeLiveQuestionMessage, OpenCodeQuestionAnswers } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface OpenCodeQuestionMessageProps {
  message: OpenCodeLiveQuestionMessage
  onReply: (answers: OpenCodeQuestionAnswers) => void
  onReject: () => void
}

export function OpenCodeQuestionMessage({
  message,
  onReply,
  onReject
}: OpenCodeQuestionMessageProps): JSX.Element {
  const [answers, setAnswers] = useState<OpenCodeQuestionAnswers>(() =>
    message.questions.map(() => [])
  )
  const [customActive, setCustomActive] = useState<Record<number, boolean>>({})

  useEffect(() => {
    setAnswers(message.questions.map(() => []))
    setCustomActive({})
  }, [message.id, message.questions])

  const responding = message.responding === true
  const canSubmit = message.questions.every((_, index) => answers[index]?.some((answer) => answer.trim()) === true)

  const selectOption = (questionIndex: number, label: string, multiple: boolean): void => {
    if (responding) return
    setCustomActive((current) => ({ ...current, [questionIndex]: false }))
    setAnswers((current) => {
      const next = current.map((answer) => [...answer])
      if (!multiple) {
        next[questionIndex] = [label]
        return next
      }
      const selected = customActive[questionIndex] ? [] : next[questionIndex] ?? []
      next[questionIndex] = selected.includes(label)
        ? selected.filter((answer) => answer !== label)
        : [...selected, label]
      return next
    })
  }

  const selectCustom = (questionIndex: number): void => {
    if (responding) return
    setCustomActive((current) => ({ ...current, [questionIndex]: true }))
    setAnswers((current) => current.map((answer, index) => (index === questionIndex ? [] : answer)))
  }

  const updateCustom = (questionIndex: number, value: string): void => {
    setAnswers((current) => current.map((answer, index) => (index === questionIndex ? [value] : answer)))
  }

  return (
    <li
      aria-live="polite"
      className="max-w-[90%] rounded border border-accent/40 bg-panel px-3 py-3 text-fg-muted"
    >
      <p className="text-xs font-medium text-fg">OpenCode has a question</p>
      <form
        className="mt-3 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit && !responding) onReply(answers.map((answer) => answer.map((value) => value.trim())))
        }}
      >
        {message.questions.map((question, questionIndex) => {
          const selected = answers[questionIndex] ?? []
          const custom = customActive[questionIndex] === true
          return (
            <fieldset key={`${message.id}-${questionIndex}`} className="space-y-2">
              <legend className="text-xs font-medium text-fg">
                {questionIndex + 1}. {question.header}
              </legend>
              <p className="text-xs text-fg-subtle">{question.question}</p>
              <div className="space-y-1.5">
                {question.options.map((option) => {
                  const isSelected = selected.includes(option.label) && !custom
                  return (
                    <button
                      key={option.label}
                      type="button"
                      disabled={responding}
                      aria-pressed={isSelected}
                      onClick={() => selectOption(questionIndex, option.label, question.multiple === true)}
                      className={`block w-full rounded border px-2.5 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                        isSelected
                          ? 'border-accent bg-accent/10 text-fg'
                          : 'border-line bg-bg hover:border-line-strong hover:bg-hover'
                      }`}
                    >
                      <span className="block text-xs font-medium">{option.label}</span>
                      {option.description && <span className="mt-0.5 block text-[11px] text-fg-subtle">{option.description}</span>}
                    </button>
                  )
                })}
                {question.custom !== false && (
                  <button
                    type="button"
                    disabled={responding}
                    aria-pressed={custom}
                    onClick={() => selectCustom(questionIndex)}
                    className={`block w-full rounded border px-2.5 py-2 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                      custom
                        ? 'border-accent bg-accent/10 text-fg'
                        : 'border-line bg-bg hover:border-line-strong hover:bg-hover'
                    }`}
                  >
                    Type your own answer
                  </button>
                )}
              </div>
              {custom && (
                <Input
                  autoFocus
                  aria-label={`Custom answer for ${question.header}`}
                  placeholder="Enter your answer…"
                  value={selected[0] ?? ''}
                  disabled={responding}
                  onChange={(event) => updateCustom(questionIndex, event.target.value)}
                />
              )}
            </fieldset>
          )
        })}
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button type="submit" size="sm" disabled={responding || !canSubmit}>
            {responding ? 'Sending…' : 'Submit answers'}
          </Button>
          <Button type="button" size="sm" variant="danger" disabled={responding} onClick={onReject}>
            Reject
          </Button>
        </div>
      </form>
    </li>
  )
}
