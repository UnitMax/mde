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
