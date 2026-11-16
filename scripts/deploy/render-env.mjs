#!/usr/bin/env node
// Prints the environment variables that render.yaml gives the API service,
// as KEY=value lines. Variables marked "sync: false" (typed into Render's
// dashboard, never stored in the repository) are listed on stderr instead.
//
// Used by prod-check.sh so the local production check runs with the very
// same variables the real deployment gets. If render.yaml is missing a
// variable the code needs, the local check fails before anything is deployed.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'render.yaml')
const lines = readFileSync(file, 'utf8').split('\n')
const typedInDashboard = []

for (let i = 0; i < lines.length; i++) {
  const key = lines[i].match(/^\s*- key:\s*(\S+)\s*$/)?.[1]
  if (!key) continue

  const next = lines[i + 1] ?? ''
  const value = next.match(/^\s*value:\s*(.*?)\s*$/)?.[1]

  if (/^\s*sync:\s*false\s*$/.test(next)) typedInDashboard.push(key)
  else if (value !== undefined) console.log(`${key}=${value.replace(/^"(.*)"$/, '$1')}`)
  else throw new Error(`render.yaml: ${key} has neither a value nor "sync: false"`)
}

console.error(`typed into the dashboard: ${typedInDashboard.join(' ')}`)
