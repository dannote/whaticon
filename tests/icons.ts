import { getIconData, iconToHTML, iconToSVG, quicklyValidateIconSet } from '@iconify/utils'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** An installed Iconify icon as SVG, as the Iconify API would serve it. */
export function iconSvg(name: string): string {
  const [prefix = '', icon = ''] = name.split(':')
  const set = quicklyValidateIconSet(
    JSON.parse(
      readFileSync(require.resolve(`@iconify-json/${prefix}/icons.json`), 'utf-8')
    ) as unknown
  )
  const data = set && getIconData(set, icon)
  if (!data) throw new Error(`${name} is not installed`)
  const { attributes, body } = iconToSVG(data)
  return iconToHTML(body, attributes)
}
