/**
 * Where text from outside a thread goes when it is sent to it: the open thread says how it takes text (a chat
 * thread attaches it as a quote above its message box; a terminal thread pastes it into its terminal), and
 * whoever has text to send, such as the Inbox terminal, hands it over by thread id without knowing which kind
 * of thread it is.
 */
type ThreadInput = (text: string) => void

const inputs = new Map<string, ThreadInput>()

/** Registers how a thread takes text; the returned function takes it back. */
export function registerThreadInput(threadId: string, input: ThreadInput): () => void {
  inputs.set(threadId, input)
  return () => {
    if (inputs.get(threadId) === input) inputs.delete(threadId)
  }
}

/** Gives the text to the thread. False when the thread is not open, so there is nowhere to put it. */
export function sendTextToThread(threadId: string, text: string): boolean {
  const input = inputs.get(threadId)
  if (!input || !text.trim()) return false
  input(text)
  return true
}

/** How long text waits for the new-thread page to open before it is dropped, so it cannot turn up much later. */
const NEW_THREAD_WAIT_MS = 3000
let newThreadInput: ThreadInput | null = null
let waiting: string[] = []
let waitingTimer: ReturnType<typeof setTimeout> | undefined

function stopWaiting(): void {
  clearTimeout(waitingTimer)
  waitingTimer = undefined
}

/**
 * Registers how the new-thread page takes text. Text that was sent while the page was still opening is handed
 * over now.
 */
export function registerNewThreadInput(input: ThreadInput): () => void {
  newThreadInput = input
  const pending = waiting
  waiting = []
  stopWaiting()
  for (const text of pending) input(text)
  return () => {
    if (newThreadInput === input) newThreadInput = null
  }
}

/**
 * Gives the text to the new-thread page. When the page is not open yet (a thread is open and the caller is
 * about to switch to it) the text waits for it.
 */
export function sendTextToNewThread(text: string): void {
  if (!text.trim()) return
  if (newThreadInput) {
    newThreadInput(text)
    return
  }
  waiting.push(text)
  stopWaiting()
  waitingTimer = setTimeout(() => {
    waiting = []
    waitingTimer = undefined
  }, NEW_THREAD_WAIT_MS)
}
