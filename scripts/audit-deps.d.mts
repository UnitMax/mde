export interface AuditException {
  /** The advisory's GitHub id, `GHSA-…`. */
  advisory: string
  package: string
  /** Why it does not reach MDE, and since when no fixed version exists. */
  reason: string
}

export interface Advisory {
  id: string
  package: string
  range: string
  severity: string
  title: string
  url?: string
}

export const EXCEPTIONS: AuditException[]
export function advisoryId(url: string | undefined): string | null
export function advisoriesOf(report: unknown): Map<string, Advisory>
export function compareVersions(a: string, b: string): number
export function inRange(version: string, range: string): boolean
export function newestRelease(versions: string[]): string | null
export function auditVerdict(
  report: unknown,
  exceptions: AuditException[],
  published: Map<string, string[]>,
): { problems: string[]; excused: string[] }
