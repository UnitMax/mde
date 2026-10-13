import { it } from 'vitest'
import { runWindowsExecutableCheck } from './helpers/windows-executable-check'

it.skipIf(process.platform !== 'win32' || process.env.MDE_WINDOWS_EXECUTABLE_INTEGRATION !== '1')(
  'ignores runnable cwd/PATH sentinels in real Windows WSL, history and ConPTY launches',
  runWindowsExecutableCheck,
  120_000,
)
