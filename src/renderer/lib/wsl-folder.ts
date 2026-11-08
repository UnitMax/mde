export interface FolderCrumb {
  /** What the breadcrumb shows: `/` for the root, the folder name otherwise. */
  name: string
  /** The absolute path the crumb leads to. */
  path: string
}

/** The folders from the root down to `path`, for the breadcrumb: `/home/me` is `/`, `home`, `me`. */
export function folderCrumbs(path: string): FolderCrumb[] {
  const crumbs: FolderCrumb[] = [{ name: '/', path: '/' }]
  let current = ''
  for (const part of path.split('/')) {
    if (!part) continue
    current = `${current}/${part}`
    crumbs.push({ name: part, path: current })
  }
  return crumbs
}

/** The folder above `path`, or null for the root. */
export function parentFolder(path: string): string | null {
  if (path === '/' || !path.startsWith('/')) return null
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

export function childFolder(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`
}
