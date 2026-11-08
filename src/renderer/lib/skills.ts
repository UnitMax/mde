import type { ChatSkill } from '@shared/types'
import type { SkillTrigger } from '@shared/skills'

/** The picker shows no more than this many at once; typing narrows the rest down. */
export const SKILL_MATCH_LIMIT = 50

/** A description only counts for a query long enough to mean something, and only where a word starts. */
const DESCRIPTION_MIN_QUERY = 3

/** Whether a word of the description starts with the needle; short needles match nothing. */
export function describes(description: string | undefined, needle: string): boolean {
  if (!description || needle.length < DESCRIPTION_MIN_QUERY) return false
  const text = description.toLowerCase()
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    if (at === 0 || !/[a-z0-9]/.test(text[at - 1]!)) return true
  }
  return false
}

/**
 * The skills that fit what was typed after the `$`: names that start with it first, then names that
 * contain it, then descriptions with a word that starts with it. Within a group OpenCode's order is
 * kept. Nothing typed yet lists them all.
 */
export function filterSkills(skills: readonly ChatSkill[], query: string): ChatSkill[] {
  const needle = query.toLowerCase()
  if (!needle) return skills.slice(0, SKILL_MATCH_LIMIT)
  const ranked: Array<{ skill: ChatSkill; rank: number; index: number }> = []
  skills.forEach((skill, index) => {
    const id = skill.id.toLowerCase()
    const name = skill.name.toLowerCase()
    const rank = id.startsWith(needle) ? 0
      : name.startsWith(needle) ? 1
        : id.includes(needle) || name.includes(needle) ? 2
          : describes(skill.description, needle) ? 3 : -1
    if (rank >= 0) ranked.push({ skill, rank, index })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).slice(0, SKILL_MATCH_LIMIT).map((entry) => entry.skill)
}

/**
 * Writes the chosen skill over the `$word` being typed, with a space after it so typing carries on.
 * A space or line break that already follows is kept, not doubled.
 */
export function applySkill(text: string, trigger: SkillTrigger, skill: ChatSkill): { text: string; caret: number } {
  const written = `$${skill.id}`
  const after = text.slice(trigger.end)
  const gap = /^\s/.test(after) ? '' : ' '
  const caret = trigger.start + written.length + (gap || after.startsWith(' ') ? 1 : 0)
  return { text: text.slice(0, trigger.start) + written + gap + after, caret }
}
