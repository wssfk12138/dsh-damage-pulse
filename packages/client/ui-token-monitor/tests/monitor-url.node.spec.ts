import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { tokenMonitorUrl } from '../src/client/monitorUrl.ts'

it('leaves plugin routes unchanged without a browser document', () => {
  expect(typeof document).toBe('undefined')
  expect(tokenMonitorUrl('/api/token-monitor/settings')).toBe('/api/token-monitor/settings')
})

it('keeps plugin-owned route literals behind the mount resolver', () => {
  const directory = fileURLToPath(new URL('../src/client/', import.meta.url))
  const violations: string[] = []
  for (const file of readdirSync(directory).filter(name => /\.tsx?$/.test(name) && name !== 'monitorUrl.ts')) {
    const lines = readFileSync(join(directory, file), 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (/^\s*(?:\*|\/\/)/.test(line)) return
      if (/\/api\/token-monitor|\/token-monitor-assets/.test(line) && !line.includes('tokenMonitorUrl')) {
        violations.push(`${file}:${index + 1}: ${line.trim()}`)
      }
    })
  }
  expect(violations).toEqual([])
})
