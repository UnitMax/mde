import type { OpenCodeConfigTarget } from '@shared/opencode-config'
import type { OpenCodeTarget } from '@shared/types'
import type { OpenCodeServiceClient } from '../service/client'
import { parseProviderNames } from '../service/parse'
import { nativeConfigFileSystem, wslConfigFileSystem } from './files'
import { OpenCodeConfigService } from './service'

export { OpenCodeConfigService } from './service'

function serviceTarget(target: OpenCodeConfigTarget): OpenCodeTarget {
  if (target.kind === 'wsl') {
    if (!target.distro) throw new Error('A WSL target needs a distribution.')
    return { kind: 'wsl', distro: target.distro }
  }
  return { kind: 'native' }
}

/** The providers the running OpenCode lists (the active ones; a disabled provider is not among them). */
export async function listKnownProviders(
  client: Pick<OpenCodeServiceClient, 'request'>,
  target: OpenCodeConfigTarget,
): Promise<{ id: string; name: string }[]> {
  const providers = parseProviderNames(await client.request(serviceTarget(target), 'provider.list'))
  return [...providers].map(([id, name]) => ({ id, name }))
}

/** The configuration editor's service, wired to the real file system and the running OpenCode service. */
export function createOpenCodeConfigService(options: {
  client: Pick<OpenCodeServiceClient, 'request'>
  /** Called after a save; the Inbox drops what it cached from OpenCode (the model lists). */
  onSaved: () => void
}): OpenCodeConfigService {
  return new OpenCodeConfigService({
    fileSystem: (target) => {
      const place = serviceTarget(target)
      return place.kind === 'wsl' ? wslConfigFileSystem(place.distro) : nativeConfigFileSystem()
    },
    knownProviders: (target) => listKnownProviders(options.client, target),
    onSaved: options.onSaved,
  })
}
