import {
  BookOpen,
  Bot,
  Boxes,
  Braces,
  Brush,
  Bug,
  Building2,
  Camera,
  ChartLine,
  Cloud,
  Code,
  Cog,
  Compass,
  Cpu,
  Database,
  FileText,
  Film,
  Flame,
  Folder,
  FolderGit2,
  FlaskConical,
  Gamepad2,
  GraduationCap,
  Hammer,
  Heart,
  House,
  Key,
  Layers,
  Leaf,
  Lightbulb,
  type LucideIcon,
  Mail,
  Map as MapIcon,
  MessageSquare,
  Monitor,
  Music,
  Network,
  Package,
  PenTool,
  Palette,
  Puzzle,
  Rocket,
  Server,
  Shield,
  Smartphone,
  Sparkles,
  Star,
  Store,
  Target,
  Terminal,
  TestTube,
  Trophy,
  Wrench,
  Zap,
  Globe,
  Briefcase,
} from 'lucide-react'
import type { InboxFolderIcon, InboxFolderSymbol } from '@shared/types'
import { inboxFolderColorHex } from '@shared/inbox-folder-icons'
import { cn } from '@/lib/utils'

/** How each built-in picture is drawn. Typed over every id, so a picture cannot be added without its drawing. */
export const PROJECT_SYMBOLS: Record<InboxFolderSymbol, LucideIcon> = {
  folder: Folder,
  repository: FolderGit2,
  code: Code,
  terminal: Terminal,
  braces: Braces,
  bug: Bug,
  rocket: Rocket,
  web: Globe,
  server: Server,
  database: Database,
  cloud: Cloud,
  chip: Cpu,
  package: Package,
  boxes: Boxes,
  layers: Layers,
  wrench: Wrench,
  hammer: Hammer,
  gear: Cog,
  lab: FlaskConical,
  tests: TestTube,
  design: Palette,
  brush: Brush,
  pen: PenTool,
  document: FileText,
  book: BookOpen,
  learning: GraduationCap,
  work: Briefcase,
  company: Building2,
  shop: Store,
  mobile: Smartphone,
  desktop: Monitor,
  game: Gamepad2,
  music: Music,
  camera: Camera,
  video: Film,
  mail: Mail,
  chat: MessageSquare,
  bot: Bot,
  sparkles: Sparkles,
  lightning: Zap,
  fire: Flame,
  nature: Leaf,
  star: Star,
  heart: Heart,
  security: Shield,
  key: Key,
  compass: Compass,
  map: MapIcon,
  idea: Lightbulb,
  puzzle: Puzzle,
  target: Target,
  trophy: Trophy,
  chart: ChartLine,
  home: House,
  network: Network,
}

const SIZES = {
  /** Next to a thread's folder line in the sidebar. */
  sm: { box: 'h-3 w-3', emoji: 'text-[10px]' },
  md: { box: 'h-4 w-4', emoji: 'text-[13px]' },
  lg: { box: 'h-5 w-5', emoji: 'text-[16px]' },
} as const

/**
 * A project's picture: a built-in one in its tint, an emoji, or the plain folder when it has none. It
 * is decoration, so it is hidden from assistive technology; the project's name is always beside it.
 */
export function ProjectIcon({
  icon,
  size = 'sm',
  className,
}: {
  icon?: InboxFolderIcon
  size?: keyof typeof SIZES
  className?: string
}): JSX.Element {
  const dimensions = SIZES[size]
  if (icon?.kind === 'emoji') {
    return (
      <span
        aria-hidden="true"
        data-testid="project-icon"
        data-icon="emoji"
        className={cn('inline-flex shrink-0 items-center justify-center leading-none', dimensions.box, dimensions.emoji, className)}
      >
        {icon.emoji}
      </span>
    )
  }
  const Picture = PROJECT_SYMBOLS[icon?.id ?? 'folder']
  const color = icon ? inboxFolderColorHex(icon.color) : undefined
  return (
    <Picture
      aria-hidden="true"
      data-testid="project-icon"
      data-icon={icon?.id ?? 'folder'}
      className={cn('shrink-0', dimensions.box, className)}
      {...(color ? { style: { color } } : {})}
    />
  )
}
