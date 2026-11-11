/**
 * Splits a byte stream into newline-terminated UTF-8 lines, as MCP's stdio transport and MDE's socket both
 * frame their messages. A line longer than `limit` bytes is dropped whole (reported once, through `onOverflow`)
 * so one oversized message can neither be half-read nor hold memory without end.
 */
export class LineSplitter {
  private chunks: Buffer[] = []
  private size = 0
  private discarding = false

  constructor(
    private readonly limit: number,
    private readonly onLine: (line: string) => void,
    private readonly onOverflow: () => void = () => undefined,
  ) {}

  push(data: Buffer | string): void {
    let chunk = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    for (;;) {
      const end = chunk.indexOf(0x0a)
      if (end === -1) {
        this.keep(chunk)
        return
      }
      this.keep(chunk.subarray(0, end))
      chunk = chunk.subarray(end + 1)
      if (this.discarding) {
        this.discarding = false
      } else {
        const line = Buffer.concat(this.chunks).toString('utf8').replace(/\r$/, '')
        if (line.trim()) this.onLine(line)
      }
      this.chunks = []
      this.size = 0
    }
  }

  private keep(part: Buffer): void {
    if (this.discarding || part.length === 0) return
    if (this.size + part.length > this.limit) {
      this.discarding = true
      this.chunks = []
      this.size = 0
      this.onOverflow()
      return
    }
    this.chunks.push(Buffer.from(part))
    this.size += part.length
  }
}
