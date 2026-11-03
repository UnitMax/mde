import { act } from 'react'
import { EditorView } from '@codemirror/view'

export function messageInput(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>('[data-testid="chat-input"] .cm-content')
  const view = content && EditorView.findFromDOM(content)
  if (!view) throw new Error('Message input is not mounted')
  return view
}

export async function setMessageText(view: EditorView, text: string, caret = text.length): Promise<void> {
  await act(async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: caret } })
  })
}

export async function pressMessageKey(view: EditorView, key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  await act(async () => { view.contentDOM.dispatchEvent(event) })
  return event
}
