export function HighlightedText({ value, positions }: { value: string; positions?: number[] }): JSX.Element {
  const matched = new Set(positions ?? [])
  return (
    <>
      {value.split('').map((character, index) => (
        <span key={`${character}-${index}`} className={matched.has(index) ? 'text-accent' : undefined}>
          {character}
        </span>
      ))}
    </>
  )
}
