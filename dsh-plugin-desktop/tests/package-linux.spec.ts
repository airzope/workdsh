import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LinuxAuditReport } from '../scripts/linux-glibc-audit.ts'
import {
  debianArchitecture,
  linuxApplicationDirectory,
  packageLinuxDeb,
  type LinuxPackageOptions,
} from '../scripts/package-linux.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function desktop(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-linux-package-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.0.6-alpha.1' }))
  mkdirSync(join(root, 'dist'))
  return root
}

function report(arch: 'x64' | 'arm64', tooNew: Record<string, string[]> = {}): LinuxAuditReport {
  return {
    application: 'linux-unpacked',
    arch,
    images: 120,
    otherArchitectures: [],
    wrongArchitecture: [],
    missingOfflineFiles: [],
    tooNew,
    newest: { GLIBC: '2.28' },
  }
}

function options(root: string, steps: string[], overrides: Partial<LinuxPackageOptions> = {}): LinuxPackageOptions {
  const arch = (overrides.arch ?? 'x64') as 'x64' | 'arm64'
  return {
    platform: 'linux',
    arch,
    nodeVersion: '22.23.2',
    env: { PATH: '/usr/bin' },
    workspaceRoot: join(root, '..'),
    desktopRoot: root,
    builderCli: '/builder/cli.js',
    nodeExecutable: '/usr/bin/node',
    run: (command, args) => {
      steps.push(`${command} ${args.join(' ')}`)
      if (command === '/usr/bin/node') {
        writeFileSync(join(root, 'dist', `WorkDSH-2.0.6-alpha.1-linux-${debianArchitecture(arch)}.deb`), '!<arch>')
      }
    },
    audit: (application, target) => {
      steps.push(`audit ${application} ${target}`)
      return report(target)
    },
    prepareNativeBindings: (profile, target) => {
      steps.push(`bindings ${profile} ${target}`)
      return []
    },
    debField: (_deb, field) => ({ Package: 'workdsh', Architecture: debianArchitecture(arch), Recommends: 'fonts-noto-cjk' })[field] ?? '',
    log: () => undefined,
    ...overrides,
  }
}

describe('Ubuntu deb packaging', () => {
  it('checks, builds natively, audits for Ubuntu 20.04 and verifies the control fields', () => {
    const root = desktop()
    const steps: string[] = []

    const deb = packageLinuxDeb(options(root, steps))

    expect(deb).toBe(join(root, 'dist', 'WorkDSH-2.0.6-alpha.1-linux-amd64.deb'))
    expect(steps).toEqual([
      'corepack yarn workspace dsh-plugin-desktop check:linux-package',
      `bindings ${join(root, 'build', 'workdsh-runtime', 'profiles', 'workdsh')} x64`,
      '/usr/bin/node /builder/cli.js --linux deb --x64 --publish never --config.npmRebuild=false',
      `audit ${linuxApplicationDirectory(root, 'x64')} x64`,
    ])
    expect(JSON.parse(readFileSync(join(root, 'dist', 'linux-x64-audit.json'), 'utf8'))).toMatchObject({ images: 120 })
  })

  it('names the arm64 application directory and package', () => {
    const root = desktop()
    const steps: string[] = []

    const deb = packageLinuxDeb(options(root, steps, { arch: 'arm64', env: { DSH_PACKAGE_CHECK_ALREADY_RAN: '1' } }))

    expect(deb).toBe(join(root, 'dist', 'WorkDSH-2.0.6-alpha.1-linux-arm64.deb'))
    expect(steps).toEqual([
      `bindings ${join(root, 'build', 'workdsh-runtime', 'profiles', 'workdsh')} arm64`,
      '/usr/bin/node /builder/cli.js --linux deb --arm64 --publish never --config.npmRebuild=false',
      `audit ${join(root, 'dist', 'linux-arm64-unpacked')} arm64`,
    ])
  })

  it('rebuilds incompatible Profile bindings before electron-builder copies the Profile', () => {
    const root = desktop()
    const steps: string[] = []
    const logs: string[] = []

    packageLinuxDeb(options(root, steps, {
      env: { DSH_PACKAGE_CHECK_ALREADY_RAN: '1' },
      prepareNativeBindings: () => {
        steps.push('rebuild')
        return ['node_modules/sherpa-onnx-linux-x64/sherpa-onnx.node']
      },
      log: message => logs.push(message),
    }))

    expect(steps.indexOf('rebuild')).toBeLessThan(steps.findIndex(step => step.includes('/builder/cli.js')))
    expect(logs).toContain('Rebuilt for Ubuntu 20.04: node_modules/sherpa-onnx-linux-x64/sherpa-onnx.node')
  })

  it('fails when a bundled binary needs a newer glibc than Ubuntu 20.04', () => {
    const root = desktop()
    expect(() => packageLinuxDeb(options(root, [], {
      audit: target => report('x64', { 'GLIBC_2.34': [`${target}/native.node`] }),
    }))).toThrow(/GLIBC_2\.34 is newer than Ubuntu 20\.04/u)
  })

  it('rejects foreign hosts and mismatched package metadata', () => {
    const root = desktop()
    expect(() => packageLinuxDeb(options(root, [], { platform: 'darwin' }))).toThrow(/native Linux host/u)
    expect(() => packageLinuxDeb(options(root, [], { arch: 'ia32' }))).toThrow(/x64 or arm64/u)
    expect(() => packageLinuxDeb(options(root, [], { nodeVersion: '20.19.0' }))).toThrow(/Node 22\.19\+/u)
    expect(() => packageLinuxDeb(options(root, [], { debField: () => 'dsh-plugin-desktop' })))
      .toThrow(/Package=dsh-plugin-desktop, expected workdsh/u)
  })
})
