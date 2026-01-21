#!/usr/bin/env bun
/**
 * Release indexes to GitHub
 *
 * Usage:
 *   VERSION=1.0.0 bun run scripts/release-indexes.ts
 *
 * Creates a GitHub release with index files as assets.
 * Requires: gh CLI authenticated
 */
import { execSync } from 'child_process'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'

const REPO = 'dannote/whaticon'
const INDEXES_DIR = resolve(import.meta.dirname, '../dist/indexes')

function run(cmd: string): string {
  console.log(`$ ${cmd}`)
  return execSync(cmd, { encoding: 'utf-8' }).trim()
}

async function main() {
  const version = process.env.VERSION
  if (!version) {
    console.error('ERROR: VERSION env var required')
    console.error('Usage: VERSION=1.0.0 bun run scripts/release-indexes.ts')
    process.exit(1)
  }

  const tag = `index-v${version}`

  // Check indexes exist
  if (!existsSync(INDEXES_DIR)) {
    console.error(`ERROR: ${INDEXES_DIR} not found`)
    console.error('Run: bun run scripts/build-all-indexes.ts')
    process.exit(1)
  }

  const manifest = JSON.parse(readFileSync(resolve(INDEXES_DIR, 'manifest.json'), 'utf-8'))
  const variants = Object.keys(manifest.variants)

  console.log(`\nReleasing indexes v${version}`)
  console.log(`Variants: ${variants.join(', ')}`)

  // Collect all files to upload
  const assets: string[] = []
  for (const variant of variants) {
    const variantDir = resolve(INDEXES_DIR, variant)
    for (const file of readdirSync(variantDir)) {
      assets.push(resolve(variantDir, file))
    }
  }
  assets.push(resolve(INDEXES_DIR, 'manifest.json'))

  console.log(`\nAssets (${assets.length}):`)
  assets.forEach((a) => console.log(`  ${a}`))

  // Generate release notes
  const notes = `## Icon Index Release v${version}

### Variants

| Variant | Icons | Size |
|---------|-------|------|
${Object.entries(manifest.variants)
  .map(
    ([name, info]: [string, any]) =>
      `| ${name} | ${info.icons.toLocaleString()} | ${(info.sizeBytes / 1024 / 1024).toFixed(2)} MB |`
  )
  .join('\n')}

### Files per variant
- \`names.txt.gz\` — icon names (gzipped text)
- \`hashes.bin.gz\` — perceptual hashes (gzipped binary)
- \`metadata.json\` — variant metadata

### Usage
\`\`\`bash
# Download specific variant
curl -LO https://github.com/${REPO}/releases/download/${tag}/popular/names.txt.gz
curl -LO https://github.com/${REPO}/releases/download/${tag}/popular/hashes.bin.gz
\`\`\`
`

  console.log('\n--- Release Notes ---')
  console.log(notes)
  console.log('---------------------\n')

  // Create release
  const assetArgs = assets.map((a) => `"${a}"`).join(' ')

  try {
    // Check if release exists
    try {
      run(`gh release view ${tag} --repo ${REPO}`)
      console.log(`Release ${tag} exists, deleting...`)
      run(`gh release delete ${tag} --repo ${REPO} --yes`)
    } catch {
      // Release doesn't exist, that's fine
    }

    // Create new release
    console.log(`Creating release ${tag}...`)
    run(
      `gh release create ${tag} --repo ${REPO} --title "Index v${version}" --notes "${notes.replace(/"/g, '\\"')}" ${assetArgs}`
    )

    console.log(`\n✅ Released: https://github.com/${REPO}/releases/tag/${tag}`)
  } catch (e) {
    console.error('Failed to create release:', e)
    process.exit(1)
  }
}

main()
