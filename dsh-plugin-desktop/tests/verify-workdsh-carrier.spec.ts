import { describe, expect, it } from 'vitest'
import { normalizeAsarEntry, packagedBrandProblems } from '../scripts/verify-workdsh-carrier.ts'

describe('ASAR inventory paths', () => {
  it('recognizes the Electron entry point on Windows and macOS', () => {
    expect(normalizeAsarEntry('\\lib\\workdsh-main.js')).toBe('lib/workdsh-main.js')
    expect(normalizeAsarEntry('/lib/workdsh-main.js')).toBe('lib/workdsh-main.js')
    expect(normalizeAsarEntry('\\node_modules\\@deepseek-ai\\dsh\\package.json'))
      .toBe('node_modules/@deepseek-ai/dsh/package.json')
  })
})

describe('packaged brand', () => {
  const entries = ['lib/workdsh-main.js', 'build/brand/brand.json', 'build/brand/app-icon.png', 'build/brand/mark.svg']

  it('accepts a brand whose mark is unpacked for the runtime', () => {
    expect(packagedBrandProblems(entries, { mark: 'mark.svg' }, path => path === 'build/brand/mark.svg')).toEqual([])
  })

  it('reports missing brand files and a mark left inside the archive', () => {
    expect(packagedBrandProblems(['lib/workdsh-main.js'], undefined, () => false))
      .toEqual(['missing build/brand/brand.json', 'missing build/brand/app-icon.png'])
    expect(packagedBrandProblems(entries, { mark: 'mark.svg' }, () => false))
      .toEqual(['build/brand/mark.svg is not unpacked for the runtime'])
    expect(packagedBrandProblems(entries, { mark: '../secret' }, () => true)).toEqual(['brand.json names no mark'])
  })
})
