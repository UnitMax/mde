/**
 * Marching squares on a regular grid: the line segments where a scalar field crosses a level. A sample at column
 * `c`, row `r` is at (c * cell, r * cell) and sits at `field[r * cols + c]`.
 *
 * Segments are appended to `out` as x1, y1, x2, y2.
 */
export function emitCellSegments(
  field: ArrayLike<number>,
  cols: number,
  column: number,
  row: number,
  cell: number,
  level: number,
  out: number[]
): void {
  const topLeft = field[row * cols + column]!
  const topRight = field[row * cols + column + 1]!
  const bottomRight = field[(row + 1) * cols + column + 1]!
  const bottomLeft = field[(row + 1) * cols + column]!
  const index =
    (topLeft > level ? 8 : 0) + (topRight > level ? 4 : 0) + (bottomRight > level ? 2 : 0) + (bottomLeft > level ? 1 : 0)
  if (index === 0 || index === 15) return

  const x = column * cell
  const y = row * cell
  // Where the line crosses each edge of the cell.
  const top = (): [number, number] => [x + cell * ((level - topLeft) / (topRight - topLeft)), y]
  const right = (): [number, number] => [x + cell, y + cell * ((level - topRight) / (bottomRight - topRight))]
  const bottom = (): [number, number] => [x + cell * ((level - bottomLeft) / (bottomRight - bottomLeft)), y + cell]
  const left = (): [number, number] => [x, y + cell * ((level - topLeft) / (bottomLeft - topLeft))]
  const join = (from: [number, number], to: [number, number]): void => {
    out.push(from[0], from[1], to[0], to[1])
  }

  switch (index) {
    case 1: case 14: join(left(), bottom()); break
    case 2: case 13: join(bottom(), right()); break
    case 3: case 12: join(left(), right()); break
    case 4: case 11: join(top(), right()); break
    case 6: case 9: join(top(), bottom()); break
    case 7: case 8: join(left(), top()); break
    case 5:
    case 10: {
      // The two high corners are opposite each other. Whether they join through the middle depends on the middle.
      const centerHigh = (topLeft + topRight + bottomRight + bottomLeft) / 4 > level
      const lowCornersCut = index === 5 ? centerHigh : !centerHigh
      if (lowCornersCut) {
        join(left(), top())
        join(bottom(), right())
      } else {
        join(left(), bottom())
        join(top(), right())
      }
      break
    }
  }
}

/** Every segment of one level across the whole grid. */
export function contourSegments(
  field: ArrayLike<number>,
  cols: number,
  rows: number,
  cell: number,
  level: number
): number[] {
  const out: number[] = []
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < cols - 1; column += 1) {
      emitCellSegments(field, cols, column, row, cell, level, out)
    }
  }
  return out
}
