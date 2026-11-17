# whaticon

Find matching [Iconify](https://iconify.design) icons by visual similarity.

Given an SVG, `whaticon` renders it and compares against indexed icons using perceptual hashing to find the closest matches.

## Installation

```bash
npm install whaticon sharp
```

[sharp](https://sharp.pixelplumbing.com/) renders SVG for the CLI and the Node API. It is an optional peer dependency, so a host that rasterizes icons itself and uses only `whaticon/hash` can leave it out. To run the CLI without installing anything:

```bash
npx -p whaticon -p sharp whaticon icon.svg
```

## CLI Usage

```bash
# Find matches for an SVG file
npx whaticon icon.svg

# Find similar icons to a known icon
npx whaticon --icon lucide:home

# Limit to specific icon sets
npx whaticon icon.svg --prefix lucide,tabler

# Prefer certain icon sets (sorted first at equal similarity)
npx whaticon icon.svg --prefer lucide

# Adjust threshold and limit
npx whaticon icon.svg --threshold 0.9 --limit 5

# Use different index size
npx whaticon icon.svg --index full    # 200k+ icons
npx whaticon icon.svg --index core    # ~10k icons (faster)

# JSON output
npx whaticon icon.svg --json
```

### Options

| Option | Description |
|--------|-------------|
| `-n, --limit <n>` | Maximum results (default: 10) |
| `-t, --threshold <n>` | Minimum similarity 0-1 (default: 0.8) |
| `-p, --prefix <sets>` | Limit to icon sets (comma-separated) |
| `--prefer <sets>` | Prefer these icon sets (comma-separated) |
| `-i, --index <variant>` | Index: `core`, `popular` (default), `full` |
| `-j, --json` | Output as JSON |

## Index Variants

| Variant | Icons | Size | Description |
|---------|-------|------|-------------|
| `core` | ~10k | ~0.4 MB | lucide, heroicons, tabler |
| `popular` | ~57k | ~1.8 MB | 12 popular sets (default) |
| `full` | ~200k+ | ~6 MB | All Iconify sets |

The `popular` index is bundled with the package. Other variants are downloaded on first use to `$XDG_CACHE_HOME/whaticon/` (`~/.cache/whaticon/` by default), and downloaded again once a whaticon update hashes icons another way.

## API Usage

```typescript
import { findMatches, loadIndex } from 'whaticon'
import { ensureIndex } from 'whaticon/download'

// Ensure index is available (downloads if needed)
const { namesGz, hashesGz } = await ensureIndex('popular')
const index = loadIndex(namesGz, hashesGz)

// Find matches
const svg = '<svg>...</svg>'
const matches = await findMatches(svg, index, {
  limit: 5,
  threshold: 0.85,
  prefixes: ['lucide', 'mdi'],
  prefer: ['lucide']
})

console.log(matches)
// [
//   { name: 'lucide:home', similarity: 0.95 },
//   { name: 'mdi:home', similarity: 0.92 },
//   ...
// ]
```

### Functions

#### `findMatches(svg, index, options?)`
Find matching icons from an index.

#### `computeDHash(svg, size?)`
Compute difference hash for an SVG. Returns 128-byte Buffer.

#### `loadIndex(namesGz, hashesGz)`
Load index from gzipped binary files.

#### `ensureIndex(variant)`
Ensure index is downloaded, returns gzipped buffers.

#### `isIndexDownloaded(variant)`
Check if index variant is cached locally.

### Without Node

`whaticon/hash` has no Node or native dependencies, for hosts that rasterize SVG themselves, such as a browser canvas or an app's own renderer. Rasterize the icon as the index was built: drawn at the largest size that fits a 33 by 32 box, centered, on transparency, then one byte per pixel of `255 - alpha`, so the shapes' coverage counts and their color does not.

```ts
import { dHashFromPixels, findMatchesByHash, parseIndex } from 'whaticon/hash'

// names.txt and hashes.bin, ungzipped, for example with DecompressionStream
const index = parseIndex(namesText, hashesBytes)
const matches = findMatchesByHash(dHashFromPixels(grayscalePixels), index, { threshold: 0.9 })
```

Icons whose hashes are identical, as sets that copy another's are, come back as one match with the others in `siblings`, led by a `prefer`red set's icon. An index's `metadata.json` records the `scheme` it was hashed with; `isCompatibleIndex(metadata)` tells whether this version hashes the same way.

## Building Custom Index

```typescript
import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { buildIndex } from 'whaticon'

// The body and viewBox of each icon, as @iconify/utils' iconToSVG returns them
const icons = [
  { name: 'my:icon1', body: '<path d="..."/>', viewBox: [0, 0, 24, 24] },
  { name: 'my:icon2', body: '<path d="..."/>', viewBox: [0, 0, 512, 448] },
]

const { names, hashes } = await buildIndex(icons)

writeFileSync('names.txt.gz', gzipSync(names))
writeFileSync('hashes.bin.gz', gzipSync(hashes))
```

## How It Works

1. **Render**: SVG is rendered with [sharp](https://sharp.pixelplumbing.com/) to a 33×32 image of how much its shapes cover each pixel, whatever their color, fitted and centered
2. **Hash**: A [difference hash (dHash)](https://www.hackerfactor.com/blog/index.php?/archives/529-Kind-of-Like-That.html) is computed — comparing adjacent pixels to produce 1024 bits
3. **Match**: Hamming distance between hashes determines similarity

### Performance

- **Index build**: ~700 icons/sec, each hashed exactly as a query is
- **Search**: ~15ms per query over the popular index (32-bit popcount)
- **Index size**: ~30 bytes per icon (gzip compressed)

## Index Format

Two gzip-compressed files:
- `names.txt.gz` — icon names, one per line
- `hashes.bin.gz` — 128 bytes per icon, concatenated

## License

MIT
