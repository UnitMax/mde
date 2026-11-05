import { GitFork, MessageCircleQuestionMark, SquareSlash, type LucideIcon } from 'lucide-react'

/** The picture of each command, by name; a command without one gets the plain slash. */
const ICONS: Record<string, LucideIcon> = {
  btw: MessageCircleQuestionMark,
  fork: GitFork,
}

export function SlashCommandIcon({ name, className }: { name: string; className?: string }): JSX.Element {
  const Icon = ICONS[name] ?? SquareSlash
  return <Icon aria-hidden className={className} />
}
