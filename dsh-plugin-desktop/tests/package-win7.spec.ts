import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  packageWindows7OfflineInstaller,
  windows7BuilderArguments,
  type Windows7PackageOptions,
} from '../scripts/package-win7.ts'
import verifyWindows7OfflineBuild from '../scripts/verify-win7-offline-installer.ts'
import type { Windows7AuditReport } from '../scripts/windows7-payload-audit.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function desktop(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-win7-package-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.0.6-alpha.1' }))
  mkdirSync(join(root, 'dist', 'win-unpacked', 'resources'), { recursive: true })
  writeFileSync(join(root, 'dist', 'win-unpacked', 'resources', 'app.asar'), '')
  return root
}

function report(unresolvedImports: Record<string, string[]> = {}): Windows7AuditReport {
  return {
    application: 'win-unpacked',
    images: 143,
    skippedNonX64: [],
    missingOfflineFiles: [],
    unresolvedImports,
    resolvedBy: {},
  }
}

function options(root: string, steps: string[], overrides: Partial<Windows7PackageOptions> = {}): Windows7PackageOptions {
  return {
    platform: 'win32',
    arch: 'x64',
    env: { PATH: 'C:\\Windows', CSC_LINK: 'secret' },
    desktopRoot: root,
    builderCli: 'C:\\builder\\cli.js',
    nodeExecutable: 'C:\\node.exe',
    audit: () => { steps.push('audit'); return report() },
    preparePayload: async () => {
      steps.push('payload')
      return { vxkexSetup: 'kex.exe', vcRedist: 'vc.exe', vcRedistVersion: { major: 14, minor: 44, build: 35211, revision: 0 } }
    },
    run: (command, args, cwd, env) => {
      steps.push('build')
      expect(command).toBe('C:\\node.exe')
      expect(args).toEqual(windows7BuilderArguments('C:\\builder\\cli.js', join(root, 'dist', 'win-unpacked'), join(root, 'dist', 'win7')))
      expect(cwd).toBe(root)
      expect(env).toEqual({
        PATH: 'C:\\Windows',
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        WORKDSH_WIN7_PREPACKAGED: join(root, 'dist', 'win-unpacked'),
      })
    },
    assertInstaller: path => steps.push(`verify ${path}`),
    log: () => undefined,
    ...overrides,
  }
}

describe('Windows 7 offline installer packaging', () => {
  it('audits the standard application before staging the payload and wrapping it', async () => {
    const root = desktop()
    const steps: string[] = []

    const installer = await packageWindows7OfflineInstaller(options(root, steps))

    expect(installer).toBe(join(root, 'dist', 'win7', 'WorkDSH-2.0.6-alpha.1-win7-x64-Offline-Setup.exe'))
    expect(steps).toEqual(['audit', 'payload', 'build', `verify ${installer}`])
    expect(JSON.parse(readFileSync(join(root, 'dist', 'windows7-audit.json'), 'utf8'))).toMatchObject({ images: 143 })
  })

  it('builds only the offline NSIS target from the prepackaged directory', () => {
    const args = windows7BuilderArguments('cli.js', 'C:\\app', 'C:\\out')
    expect(args).toContain('--prepackaged=C:\\app')
    expect(args).toContain('--config.nsis.include=installer-win7.nsh')
    expect(args).toContain('--config.nsis.artifactName=WorkDSH-${version}-win7-${arch}-Offline-Setup.${ext}')
    expect(args).toContain('--config.afterAllArtifactBuild=./scripts/verify-win7-offline-installer.ts')
    expect(args.slice(1, 3)).toEqual(['--win', 'nsis'])
  })

  it('stops before downloading or building when the audit fails', async () => {
    const root = desktop()
    const steps: string[] = []

    await expect(packageWindows7OfflineInstaller(options(root, steps, {
      audit: () => { steps.push('audit'); return report({ 'dxcore.dll': ['native.node'] }) },
    }))).rejects.toThrow(/dxcore\.dll/u)

    expect(steps).toEqual(['audit'])
    expect(existsSync(join(root, 'dist', 'windows7-audit.json'))).toBe(true)
  })

  it('requires a native Windows x64 host and a packaged standard application', async () => {
    const root = desktop()
    await expect(packageWindows7OfflineInstaller(options(root, [], { platform: 'linux' }))).rejects.toThrow(/native Windows x64/u)
    rmSync(join(root, 'dist', 'win-unpacked'), { recursive: true })
    await expect(packageWindows7OfflineInstaller(options(root, []))).rejects.toThrow(/standard Windows installer first/u)
  })
})

describe('Windows 7 offline afterAll hook', () => {
  it('verifies the wrapped executable only for the dedicated output', async () => {
    const root = desktop()
    mkdirSync(join(root, 'dist', 'win7'))
    const checked: string[] = []
    const env = { WORKDSH_WIN7_PREPACKAGED: join(root, 'dist', 'win-unpacked') }
    const verifyFuses = async (executable: string): Promise<void> => { checked.push(executable) }

    await expect(verifyWindows7OfflineBuild({ outDir: join(root, 'dist', 'win7') }, { desktopRoot: root, env, verifyFuses }))
      .resolves.toEqual([])
    await expect(verifyWindows7OfflineBuild({ outDir: join(root, 'dist') }, { desktopRoot: root, env, verifyFuses }))
      .rejects.toThrow(/outside the Windows 7 offline build/u)
    await expect(verifyWindows7OfflineBuild({ outDir: join(root, 'dist', 'win7') }, { desktopRoot: root, env: {}, verifyFuses }))
      .rejects.toThrow(/must wrap/u)

    // The hook resolves links such as macOS /var -> /private/var and Windows 8.3 names.
    expect(checked).toEqual([join(realpathSync(root), 'dist', 'win-unpacked', 'WorkDSH.exe')])
  })
})
