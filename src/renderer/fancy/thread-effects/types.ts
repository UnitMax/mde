/**
 * What plays inside one thread row. It draws in CSS pixels onto a canvas the host has scaled to the device, and
 * clears the canvas itself each frame.
 */
export interface RowEffect {
  /** The row is now this many CSS pixels across. */
  resize: (width: number, height: number) => void
  /** Draws the picture at `time` seconds. */
  draw: (context: CanvasRenderingContext2D, time: number) => void
  /** A still picture of the effect, for people who asked their system for less motion. */
  still: (context: CanvasRenderingContext2D) => void
}
