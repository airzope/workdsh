/** Build the Windows 7 x64 offline installer from the verified standard application directory. */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brandBuilderOverrides, builtBrand, type BrandIdentity } from './brand.ts'
import { withoutWindowsSigningSecrets } from './package-win.ts'
import { assertPortableExecutable } from './verify-win-installer.ts'
import { VXKEX_NEXT_VERSION } from './vxkex-next.ts'
import { prepareWindows7OfflinePayload, type Windows7OfflinePayload } from './windows7-offline-payload.ts'
import { assertWindows7Payload, auditWindows7Payload, type Windows7AuditReport } from './windows7-payload-audit.ts'

/** Prepackaged application the afterAll hook is allowed to verify. */
export const WINDOWS7_PREPACKAGED_ENV = 'WORKDSH_WIN7_PREPACKAGED'

/** Injectable boundary for focused tests. */
export interface Windows7PackageOptions {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly env: NodeJS.ProcessEnv
  readonly desktopRoot: string
  readonly builderCli: string
  readonly nodeExecutable: string
  readonly preparePayload: (desktopRoot: string) => Promise<Windows7OfflinePayload>
  readonly audit: (application: string) => Windows7AuditReport
  readonly run: (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) => void
  readonly assertInstaller: (path: string) => void
  readonly log: (message: string) => void
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

/** Native options for the command-line entry point. */
export function createWindows7PackageOptions(): Windows7PackageOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    desktopRoot,
    builderCli: createRequire(import.meta.url).resolve('electron-builder/cli.js'),
    nodeExecutable: process.execPath,
    preparePayload: root => prepareWindows7OfflinePayload(root),
    audit: auditWindows7Payload,
    run,
    assertInstaller: path => assertPortableExecutable(path, 'Windows 7 offline installer'),
    log: message => console.log(message),
  }
}

/**
 * electron-builder arguments that wrap an existing application in the offline NSIS installer.
 * @param builderCli - electron-builder CLI module.
 * @param application - Verified `dist/win-unpacked` directory.
 * @param output - Dedicated output directory.
 * @param brand - The built brand.
 * @returns CLI arguments.
 */
export function windows7BuilderArguments(builderCli: string, application: string, output: string, brand: BrandIdentity = builtBrand()): string[] {
  return [
    builderCli,
    '--win',
    'nsis',
    `--prepackaged=${application}`,
    '--x64',
    '--publish',
    'never',
    '--config.win.signExecutable=false',
    '--config.npmRebuild=false',
    '--config.nsis.include=installer-win7.nsh',
    ...brandBuilderOverrides(brand).filter(argument => !argument.startsWith('--config.nsis.artifactName=')),
    `--config.nsis.artifactName=${brand.fileName}-\${version}-win7-\${arch}-Offline-Setup.\${ext}`,
    // The default hook looks for an unpacked app below the output directory.
    '--config.afterAllArtifactBuild=./scripts/verify-win7-offline-installer.ts',
    `--config.directories.output=${output}`,
  ]
}

/**
 * Audit the standard application for Windows 7, stage VxKex NEXT and the VC++
 * runtime, then build `dist/win7/WorkDSH-<version>-win7-x64-Offline-Setup.exe`.
 * @param options - Host and command boundary.
 * @returns The offline installer path.
 */
export async function packageWindows7OfflineInstaller(
  options: Windows7PackageOptions = createWindows7PackageOptions(),
): Promise<string> {
  if (options.platform !== 'win32' || options.arch !== 'x64') {
    throw new Error('The Windows 7 offline installer must be built on a native Windows x64 host')
  }
  const brand = builtBrand(options.desktopRoot)
  const application = join(options.desktopRoot, 'dist', 'win-unpacked')
  if (!existsSync(join(application, 'resources', 'app.asar'))) {
    throw new Error(`Build the standard Windows installer first; ${application} is missing its application archive`)
  }
  const output = join(options.desktopRoot, 'dist', 'win7')
  rmSync(output, { recursive: true, force: true })
  const report = options.audit(application)
  const reportPath = join(options.desktopRoot, 'dist', 'windows7-audit.json')
  writeFileSync(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
  assertWindows7Payload(report)
  options.log(`Windows 7 audit passed for ${String(report.images)} x64 images; report: ${reportPath}`)
  const payload = await options.preparePayload(options.desktopRoot)
  options.log(`Bundling VxKex NEXT ${VXKEX_NEXT_VERSION} and the Microsoft VC++ runtime ${[
    payload.vcRedistVersion.major, payload.vcRedistVersion.minor, payload.vcRedistVersion.build, payload.vcRedistVersion.revision,
  ].join('.')}`)
  options.run(
    options.nodeExecutable,
    windows7BuilderArguments(options.builderCli, application, output, brand),
    options.desktopRoot,
    {
      ...withoutWindowsSigningSecrets(options.env),
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      [WINDOWS7_PREPACKAGED_ENV]: application,
    },
  )
  const { version } = JSON.parse(readFileSync(join(options.desktopRoot, 'package.json'), 'utf8')) as { version: string }
  const installer = join(output, `${brand.fileName}-${version}-win7-x64-Offline-Setup.exe`)
  options.assertInstaller(installer)
  options.log(`Built ${installer}`)
  return installer
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    await packageWindows7OfflineInstaller()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
