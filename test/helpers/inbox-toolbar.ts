import { act } from 'react'

/** Opens the Inbox tab's search, as a click on its button does, and returns the field. */
export async function openInboxSearch(container: ParentNode): Promise<HTMLInputElement> {
  const field = (): HTMLInputElement | null => container.querySelector<HTMLInputElement>('input[aria-label="Search inbox"]')
  if (!field()) await act(async () => container.querySelector<HTMLElement>('[aria-label="Search threads"]')!.click())
  return field()!
}

/** Opens the Inbox tab's filter menu from the keyboard, which Radix does in happy-dom without a pointer. */
export async function openInboxFilterMenu(container: ParentNode): Promise<void> {
  await act(async () => void container.querySelector<HTMLElement>('[aria-label="Filter threads"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}

/** Picks All, Unread or Parked from the filter menu. */
export async function showInboxThreads(container: ParentNode, label: 'All' | 'Unread' | 'Parked'): Promise<void> {
  await openInboxFilterMenu(container)
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find((entry) => entry.textContent === label)
  if (!item) throw new Error(`No filter ${label}`)
  await act(async () => item.click())
}
