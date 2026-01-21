import { describe, expect, test } from 'bun:test'
import { spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { resolve } from 'path'

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
  test('--help shows usage', async () => {
    const { stdout, code } = await run(['--help'])

    expect(code).toBe(0)
    expect(stdout).toContain('whaticon')
    expect(stdout).toContain('--limit')
    expect(stdout).toContain('--threshold')
  })

  test('--icon finds matches', async () => {
    const { stdout, code } = await run(['--icon', 'lucide:home', '-n', '3'])

    expect(code).toBe(0)
    expect(stdout).toContain('%')
    expect(stdout.split('\n').filter((l) => l.includes('%')).length).toBe(3)
  })

  test('--json outputs JSON', async () => {
    const { stdout, code } = await run(['--icon', 'lucide:home', '-n', '2', '--json'])

    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBe(2)
    expect(data[0]).toHaveProperty('name')
    expect(data[0]).toHaveProperty('similarity')
  })

  test('--prefix filters results', async () => {
    const { stdout, code } = await run(['--icon', 'lucide:home', '-p', 'mdi', '-n', '5'])

    expect(code).toBe(0)
    const lines = stdout.split('\n').filter((l) => l.includes('%'))
    for (const line of lines) {
      expect(line).toContain('mdi:')
    }
  })

  test('--threshold filters by similarity', async () => {
    const { stdout, code } = await run(['--icon', 'lucide:home', '-t', '0.95', '-n', '20', '--json'])

    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    for (const match of data) {
      expect(match.similarity).toBeGreaterThanOrEqual(0.95)
    }
  })

  test('reads SVG file', async () => {
    const tmpFile = '/tmp/test-icon.svg'
    writeFileSync(
      tmpFile,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <rect x="4" y="4" width="16" height="16" fill="black"/>
      </svg>`
    )

    try {
      const { stdout, code } = await run([tmpFile, '-n', '3'])
      expect(code).toBe(0)
      expect(stdout).toContain('%')
    } finally {
      unlinkSync(tmpFile)
    }
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
    const { stdout, code } = await run([
      '--url',
      'https://api.iconify.design/lucide/home.svg',
      '-n',
      '3'
    ])

    expect(code).toBe(0)
    expect(stdout).toContain('%')
  })
})
