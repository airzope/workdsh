/** Build an Ubuntu .deb on a native Linux x64 or arm64 host and audit it for Ubuntu 20.04. */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertLinuxPayload, auditLinuxPayload, type LinuxAuditReport } from './linux-glibc-audit.ts'

/** Injectable native Linux packaging boundary used by focused tests. */
export interface LinuxPackageOptions {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly nodeVersion: string
  readonly env: NodeJS.ProcessEnv
  readonly workspaceRoot: string
  readonly desktopRoot: string
  readonly builderCli: string
  readonly nodeExecutable: string
  readonly run: (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) => void
  readonly audit: (application: string, arch: 'x64' | 'arm64') => LinuxAuditReport
  /** Read one control field from a .deb. */
  readonly debField: (deb: string, field: string) => string
  readonly log: (message: string) => void
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

function debField(deb: string, field: string): string {
  const result = spawnSync('dpkg-deb', ['--field', deb, field], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`dpkg-deb could not read ${field} from ${deb}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

/** Native options for the command-line entry point. */
export function createLinuxPackageOptions(): LinuxPackageOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    env: process.env,
    workspaceRoot: resolve(desktopRoot, '..'),
    desktopRoot,
    builderCli: createRequire(import.meta.url).resolve('electron-builder/cli.js'),
    nodeExecutable: process.execPath,
    run,
    audit: (application, arch) => auditLinuxPayload(application, arch),
    debField,
    log: message => console.log(message),
  }
}

/** Debian architecture name of a Node architecture. */
export function debianArchitecture(arch: 'x64' | 'arm64'): 'amd64' | 'arm64' {
  return arch === 'x64' ? 'amd64' : 'arm64'
}

/** electron-builder's unpacked directory for one Linux architecture. */
export function linuxApplicationDirectory(desktopRoot: string, arch: 'x64' | 'arm64'): string {
  return join(desktopRoot, 'dist', arch === 'x64' ? 'linux-unpacked' : 'linux-arm64-unpacked')
}

/**
 * Run the package gate, build the .deb natively, audit the unpacked
 * application for Ubuntu 20.04, and check the package control fields.
 * @param options - Host and command boundary.
 * @returns The .deb path.
 */
export function packageLinuxDeb(options: LinuxPackageOptions = createLinuxPackageOptions()): string {
  if (options.platform !== 'linux') throw new Error('Linux packages must be built on a native Linux host')
  if (options.arch !== 'x64' && options.arch !== 'arm64') {
    throw new Error(`Linux packages require an x64 or arm64 host; received ${options.arch}`)
  }
  const arch = options.arch
  const versionMatch = /^(\d+)\.(\d+)\./u.exec(options.nodeVersion)
  const major = Number(versionMatch?.[1])
  const minor = Number(versionMatch?.[2])
  if (!((major === 22 && minor >= 19) || major >= 24)) {
    throw new Error(`Linux packages require Node 22.19+ or Node 24+; received ${options.nodeVersion}`)
  }
  if (options.env.DSH_PACKAGE_CHECK_ALREADY_RAN !== '1') {
    options.run('corepack', ['yarn', 'workspace', 'dsh-plugin-desktop', 'check:linux-package'], options.workspaceRoot, options.env)
  } else {
    options.log('Skipping the Linux package preflight; the package gate already passed.')
  }
  options.log(`Building an Ubuntu ${debianArchitecture(arch)} package on this ${arch} host.`)
  options.run(
    options.nodeExecutable,
    [options.builderCli, '--linux', 'deb', `--${arch}`, '--publish', 'never', '--config.npmRebuild=false'],
    options.desktopRoot,
    options.env,
  )
  const report = options.audit(linuxApplicationDirectory(options.desktopRoot, arch), arch)
  const reportPath = join(options.desktopRoot, 'dist', `linux-${arch}-audit.json`)
  writeFileSync(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
  assertLinuxPayload(report)
  options.log(`Ubuntu 20.04 audit passed for ${String(report.images)} ${arch} ELF images (newest ${JSON.stringify(report.newest)}); report: ${reportPath}`)
  const { version } = JSON.parse(readFileSync(join(options.desktopRoot, 'package.json'), 'utf8')) as { version: string }
  const deb = join(options.desktopRoot, 'dist', `WorkDSH-${version}-linux-${debianArchitecture(arch)}.deb`)
  if (!existsSync(deb)) throw new Error(`Expected Linux package is missing: ${deb}`)
  // Chinese documents render with CJK fonts, which Ubuntu desktops do not always install.
  const fields = { Package: 'workdsh', Architecture: debianArchitecture(arch), Recommends: 'fonts-noto-cjk' }
  for (const [field, expected] of Object.entries(fields)) {
    const actual = options.debField(deb, field)
    if (actual !== expected) throw new Error(`${deb} has ${field}=${actual}, expected ${expected}`)
  }
  options.log(`Linux package verification passed: ${deb}`)
  return deb
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    packageLinuxDeb()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
