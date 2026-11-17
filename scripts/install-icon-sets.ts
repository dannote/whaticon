#!/usr/bin/env bun
/**
 * Install the package of every icon set Iconify lists, without saving them to package.json,
 * so `build-all-indexes.ts` can index them all.
 */
import { execFileSync } from 'node:child_process'
import * as v from 'valibot'

const response = await fetch('https://api.iconify.design/collections')
if (!response.ok) throw new Error(`Iconify lists no collections: ${response.status}`)
const collections = v.parse(v.record(v.string(), v.unknown()), await response.json())
const packages = Object.keys(collections).map((prefix) => `@iconify-json/${prefix}`)
console.log(`Installing ${packages.length} icon sets`)
execFileSync('bun', ['add', '--no-save', ...packages], { stdio: 'inherit' })
