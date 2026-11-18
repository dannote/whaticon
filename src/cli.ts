#!/usr/bin/env node
import { defineCommand, runMain } from 'citty'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as v from 'valibot'

import { ensureIndex, isIndexDownloaded } from './download.js'
import {
  NAMED_AT,
  SHORTLIST,
  compareMatches,
  fetchIconSvg,
  findMatches,
  loadIndex,
  type HashMatchOptions,
  type IconIndex,
  type IconMatch
} from './index.js'

/** The hash similarity results start at without --compare. */
const DEFAULT_THRESHOLD = 0.8

const VariantSchema = v.picklist(['core', 'popular', 'full'])
const LimitSchema = v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1))
const ThresholdSchema = v.pipe(v.string(), v.toNumber(), v.minValue(0), v.maxValue(1))

/**
 * The closest hashes compared by drawing, those alike enough first. Exits when none could be
 * compared, as offline, which is not the same answer as none being alike enough.
 */
async function compared(
  svg: string,
  index: IconIndex,
  options: Required<Pick<HashMatchOptions, 'limit' | 'threshold'>> & HashMatchOptions
): Promise<IconMatch[]> {
  const { limit, threshold, ...filters } = options
  const shortlist = await findMatches(svg, index, {
    ...filters,
    limit: Math.max(SHORTLIST.limit, limit),
    threshold: SHORTLIST.threshold
  })
  const scored = await compareMatches(svg, shortlist)
  if (shortlist.length > 0 && scored.length === 0) {
    console.error('Could not load the icons to compare with from the Iconify API')
    process.exit(1)
  }
  return scored.filter((match) => match.similarity >= threshold).slice(0, limit)
}

/** An option's value, or exit with what it should have been. */
function option<T>(schema: v.GenericSchema<string, T>, value: string, message: string): T {
  const result = v.safeParse(schema, value)
  if (result.success) return result.output
  console.error(message)
  return process.exit(1)
}

const main = defineCommand({
  meta: {
    name: 'whaticon',
    description: 'Find matching Iconify icons by visual similarity'
  },
  args: {
    file: {
      type: 'positional',
      description: 'SVG file to match',
      required: false
    },
    url: {
      type: 'string',
      description: 'Fetch SVG from URL'
    },
    icon: {
      type: 'string',
      description: 'Find similar icons (e.g., lucide:home)'
    },
    limit: {
      type: 'string',
      alias: 'n',
      description: 'Maximum results',
      default: '10'
    },
    threshold: {
      type: 'string',
      alias: 't',
      description: 'Minimum similarity 0-1 (default: 0.8, or 0.9 with --compare)'
    },
    compare: {
      type: 'boolean',
      alias: 'c',
      description:
        'Compare the closest hashes by drawing them, fetched from the Iconify API: a similarity that tells an icon from a lookalike'
    },
    prefix: {
      type: 'string',
      alias: 'p',
      description: 'Limit to icon sets (comma-separated)'
    },
    prefer: {
      type: 'string',
      description: 'Prefer icon sets (comma-separated), sorted first at equal similarity'
    },
    index: {
      type: 'string',
      alias: 'i',
      description: 'Index variant: core, popular (default), full'
    },
    json: {
      type: 'boolean',
      alias: 'j',
      description: 'Output as JSON'
    }
  },
  async run({ args }) {
    let svg: string | undefined

    if (args.url) {
      const res = await fetch(args.url)
      if (!res.ok) {
        console.error(`Failed to fetch ${args.url}: ${res.status}`)
        process.exit(1)
      }
      svg = await res.text()
    } else if (args.icon) {
      svg = await fetchIconSvg(args.icon)
    } else if (args.file) {
      const path = resolve(args.file)
      if (!existsSync(path)) {
        console.error(`File not found: ${path}`)
        process.exit(1)
      }
      svg = readFileSync(path, 'utf-8')
    }

    if (!svg) {
      console.error('No input provided. Use --help for usage.')
      process.exit(1)
    }

    const variant = option(
      VariantSchema,
      args.index || 'popular',
      `Invalid index variant: ${args.index}. Use: core, popular, full`
    )
    const limit = option(LimitSchema, args.limit, `Invalid limit: ${args.limit}`)
    const threshold = option(
      ThresholdSchema,
      args.threshold ?? String(args.compare ? NAMED_AT : DEFAULT_THRESHOLD),
      `Invalid threshold: ${args.threshold}`
    )

    // Try bundled index first, then download
    let namesGz: Buffer
    let hashesGz: Buffer

    const bundledDir = resolve(import.meta.dirname, '../data')
    const bundledNames = resolve(bundledDir, 'names.txt.gz')
    const bundledHashes = resolve(bundledDir, 'hashes.bin.gz')

    if (variant === 'popular' && existsSync(bundledNames) && existsSync(bundledHashes)) {
      // Use bundled popular index
      namesGz = readFileSync(bundledNames)
      hashesGz = readFileSync(bundledHashes)
    } else {
      // Download from GitHub releases
      if (!isIndexDownloaded(variant)) {
        console.error(`Downloading ${variant} index...`)
      }
      const cached = await ensureIndex(variant, (msg) => console.error(msg))
      namesGz = cached.namesGz
      hashesGz = cached.hashesGz
    }

    const index = loadIndex(namesGz, hashesGz)

    const prefixes = args.prefix?.split(',').map((p) => p.trim())
    const prefer = args.prefer?.split(',').map((p) => p.trim())

    const matches = args.compare
      ? await compared(svg, index, { limit, threshold, prefixes, prefer })
      : await findMatches(svg, index, { limit, threshold, prefixes, prefer })

    if (args.json) {
      console.log(JSON.stringify(matches, null, 2))
    } else {
      if (matches.length === 0) {
        console.log('No matches found above threshold.')
      } else {
        for (const m of matches) {
          const pct = (m.similarity * 100).toFixed(1)
          console.log(`${pct}%  ${m.name}`)
        }
      }
    }
  }
})

await runMain(main)
