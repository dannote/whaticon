import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { gzipSync } from 'zlib'

import {
  getCacheDir,
  isIndexDownloaded,
  loadCachedIndex,
  clearCache,
  type IndexVariant
} from '../src/download.ts'

describe('download', () => {
  const testCacheDir = getCacheDir()

  // Clean up before and after tests
  beforeAll(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true })
    }
  })

  afterAll(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true })
    }
  })

  test('getCacheDir returns path in home directory', () => {
    const dir = getCacheDir()
    expect(dir).toContain('.cache')
    expect(dir).toContain('whaticon')
  })

  test('isIndexDownloaded returns false when not downloaded', () => {
    expect(isIndexDownloaded('core')).toBe(false)
    expect(isIndexDownloaded('popular')).toBe(false)
    expect(isIndexDownloaded('full')).toBe(false)
  })

  test('loadCachedIndex returns null when not downloaded', () => {
    expect(loadCachedIndex('core')).toBeNull()
  })

  test('isIndexDownloaded returns true after manual cache creation', () => {
    const variant: IndexVariant = 'core'
    const variantDir = join(testCacheDir, variant)
    mkdirSync(variantDir, { recursive: true })

    // Create fake index files
    writeFileSync(join(variantDir, 'names.txt.gz'), gzipSync('lucide:home\nlucide:check'))
    writeFileSync(join(variantDir, 'hashes.bin.gz'), gzipSync(Buffer.alloc(256)))

    expect(isIndexDownloaded(variant)).toBe(true)
  })

  test('loadCachedIndex returns buffers after cache creation', () => {
    const variant: IndexVariant = 'core'
    const cached = loadCachedIndex(variant)

    expect(cached).not.toBeNull()
    expect(cached!.namesGz).toBeInstanceOf(Buffer)
    expect(cached!.hashesGz).toBeInstanceOf(Buffer)
  })

  test('clearCache removes cache directory', () => {
    expect(existsSync(testCacheDir)).toBe(true)
    clearCache()
    expect(existsSync(testCacheDir)).toBe(false)
  })
})
