import { getIconData, iconToSVG, quicklyValidateIconSet } from '@iconify/utils'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import type { IconInput } from '#src/index.ts'

/** Icon sets for each index variant, read from the installed `@iconify-json/*` packages. */
export const CORE_SETS = ['lucide', 'heroicons', 'tabler']

export const POPULAR_SETS = [
  'lucide',
  'mdi',
  'heroicons',
  'tabler',
  'ph',
  'ri',
  'bi',
  'fa6-solid',
  'fa6-regular',
  'ion',
  'carbon',
  'fluent'
]

const require = createRequire(import.meta.url)

/** The icons of a set, whose package must be installed. */
export async function loadIconSet(prefix: string): Promise<IconInput[]> {
  const path = require.resolve(`@iconify-json/${prefix}/icons.json`)
  const set = quicklyValidateIconSet(JSON.parse(await readFile(path, 'utf-8')) as unknown)
  if (!set) throw new Error(`@iconify-json/${prefix} holds no valid icon set`)
  return Object.keys(set.icons).flatMap((name) => {
    const icon = getIconData(set, name)
    if (!icon) return []
    const { body, viewBox } = iconToSVG(icon)
    return [{ name: `${prefix}:${name}`, body, viewBox }]
  })
}

/** Every set whose package is installed, such as after `icon-sets/install.ts`. */
export async function installedSets(): Promise<string[]> {
  const scope = join(dirname(require.resolve('@iconify-json/lucide/package.json')), '..')
  return (await readdir(scope)).sort()
}
