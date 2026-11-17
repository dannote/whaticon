import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import {
  clearCache,
  downloadIndex,
  getCacheDir,
  isIndexDownloaded,
  loadCachedIndex
} from '../src/download.ts'
import { HASH_SCHEME } from '../src/hash.ts'

const metadata = (scheme?: string) => JSON.stringify({ scheme, icons: 2, prefixes: ['lucide'] })

/** A fake GitHub serving one index release with the given metadata. */
function serveRelease(metadataJson: string) {
  const serve = async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url.endsWith('/releases')) return Response.json([{ tag_name: 'index-v2026.11.17' }])
    if (url.endsWith('-metadata.json')) return new Response(metadataJson)
    if (url.endsWith('-names.txt.gz')) return new Response(gzipSync('lucide:a\nlucide:b'))
    if (url.endsWith('-hashes.bin.gz')) return new Response(gzipSync(Buffer.alloc(256)))
    return new Response('', { status: 404 })
  }
  return spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(serve, { preconnect: fetch.preconnect })
  )
}

describe('download', () => {
  const previousCache = process.env.XDG_CACHE_HOME
  const cacheHome = mkdtempSync(join(tmpdir(), 'whaticon-'))

  beforeAll(() => {
    process.env.XDG_CACHE_HOME = cacheHome
  })

  afterEach(() => {
    mock.restore()
    clearCache()
  })

  afterAll(() => {
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = previousCache
    rmSync(cacheHome, { recursive: true, force: true })
  })

  test('keeps indexes under XDG_CACHE_HOME', () => {
    expect(getCacheDir()).toBe(join(cacheHome, 'whaticon'))
  })

  test('has no index before one is downloaded', () => {
    expect(isIndexDownloaded('core')).toBe(false)
    expect(loadCachedIndex('core')).toBeNull()
  })

  test('downloads an index and loads it from the cache', async () => {
    serveRelease(metadata(HASH_SCHEME))
    await downloadIndex('core')

    const cached = loadCachedIndex('core')
    expect(cached?.namesGz).toBeInstanceOf(Buffer)
    expect(cached?.hashesGz).toBeInstanceOf(Buffer)
  })

  test('refuses an index hashed another way', async () => {
    serveRelease(metadata('dhash-32'))
    expect(await downloadIndex('core').catch(String)).toContain('update whaticon')
    expect(isIndexDownloaded('core')).toBe(false)
  })

  test('refuses metadata of the wrong shape', async () => {
    serveRelease('{"icons":"many"}')
    expect(await downloadIndex('core').catch(String)).toContain('Error')
  })

  test('does not load a cached index hashed another way', () => {
    const dir = join(getCacheDir(), 'core')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'names.txt.gz'), gzipSync('lucide:a'))
    writeFileSync(join(dir, 'hashes.bin.gz'), gzipSync(Buffer.alloc(128)))
    writeFileSync(join(dir, 'metadata.json'), metadata())
    expect(loadCachedIndex('core')).toBeNull()

    writeFileSync(join(dir, 'metadata.json'), metadata(HASH_SCHEME))
    expect(loadCachedIndex('core')).not.toBeNull()
  })

  test('clearCache removes the cache', () => {
    mkdirSync(getCacheDir(), { recursive: true })
    clearCache()
    expect(existsSync(getCacheDir())).toBe(false)
  })
})
