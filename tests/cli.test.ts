import { afterAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as v from 'valibot'

import { iconSvg } from './icons.ts'

const MatchesSchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.array(v.object({ name: v.string(), similarity: v.number() }))
)

const CLI = resolve(import.meta.dirname, '../dist/cli.js')

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI, ...args])
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => (stdout += data))
    proc.stderr.on('data', (data) => (stderr += data))
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }))
  })
}

describe('CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'whaticon-cli-'))
  const house = join(dir, 'lucide-house.svg')
  writeFileSync(house, iconSvg('lucide:house'))
  const server = Bun.serve({ port: 0, fetch: () => new Response(iconSvg('lucide:house')) })

  afterAll(async () => {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test('--help shows usage', async () => {
    const { stdout, code } = await run(['--help'])

    expect(code).toBe(0)
    expect(stdout).toContain('whaticon')
    expect(stdout).toContain('--limit')
    expect(stdout).toContain('--threshold')
  })

  test('finds matches for an SVG file', async () => {
    const { stdout, code } = await run([house, '-n', '3'])

    expect(code).toBe(0)
    expect(stdout).toContain('%')
    expect(stdout.split('\n').filter((l) => l.includes('%')).length).toBe(3)
  })

  test('--json outputs JSON', async () => {
    const { stdout, code } = await run([house, '-n', '2', '--json'])

    expect(code).toBe(0)
    expect(v.parse(MatchesSchema, stdout)).toHaveLength(2)
  })

  test('--prefix filters results', async () => {
    const { stdout, code } = await run([house, '-p', 'mdi', '-n', '5'])

    expect(code).toBe(0)
    const lines = stdout.split('\n').filter((l) => l.includes('%'))
    for (const line of lines) {
      expect(line).toContain('mdi:')
    }
  })

  test('--threshold filters by similarity', async () => {
    const { stdout, code } = await run([house, '-t', '0.95', '-n', '20', '--json'])

    expect(code).toBe(0)
    for (const match of v.parse(MatchesSchema, stdout)) {
      expect(match.similarity).toBeGreaterThanOrEqual(0.95)
    }
  })

  test('names the icon a file draws first', async () => {
    const { stdout, code } = await run([house, '-n', '1', '--json'])
    expect(code).toBe(0)
    expect(v.parse(MatchesSchema, stdout)).toMatchObject([{ name: 'lucide:house', similarity: 1 }])
  })

  test('error on an invalid option', async () => {
    const { stderr, code } = await run([house, '-t', 'high'])
    expect(code).toBe(1)
    expect(stderr).toContain('Invalid threshold')
  })

  test('error on an invalid icon name', async () => {
    const { stderr, code } = await run(['--icon', 'home'])
    expect(code).toBe(1)
    expect(stderr).toContain('Invalid icon name')
  })

  test('error on missing file', async () => {
    const { stderr, code } = await run(['/nonexistent/file.svg'])

    expect(code).toBe(1)
    expect(stderr).toContain('not found')
  })

  test('error on no input', async () => {
    const { stderr, code } = await run([])

    expect(code).toBe(1) // exits with error when no input provided
    expect(stderr).toContain('No input provided')
  })

  test('--url fetches from URL', async () => {
    const { stdout, code } = await run(['--url', server.url.href, '-n', '3'])

    expect(code).toBe(0)
    expect(stdout).toContain('%')
  })
})
