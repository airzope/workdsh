/** Audit a packaged macOS application for one architecture and macOS 15. */

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareDotted } from './linux-glibc-audit.ts'

/** Oldest macOS release the packages support. */
export const MACOS_MINIMUM = '15.0'

const CPU_TYPES: Readonly<Record<number, 'x64' | 'arm64'>> = { 0x01000007: 'x64', 0x0100000c: 'arm64' }
const LC_VERSION_MIN_MACOSX = 0x24
const LC_BUILD_VERSION = 0x32
const PLATFORM_MACOS = 1

/** One architecture slice of a Mach-O file. */
export interface MachOSlice {
  readonly arch: 'x64' | 'arm64' | 'other'
  /** Minimum macOS version from LC_BUILD_VERSION or LC_VERSION_MIN_MACOSX. */
  readonly minos?: string
}

function read(descriptor: number, length: number, position: number): Buffer {
  const buffer = Buffer.alloc(length)
  return buffer.subarray(0, readSync(descriptor, buffer, 0, length, position))
}

function version(encoded: number): string {
  return `${String(encoded >>> 16)}.${String((encoded >>> 8) & 0xff)}.${String(encoded & 0xff)}`
}

function thinSlice(descriptor: number, offset: number): MachOSlice | undefined {
  const header = read(descriptor, 32, offset)
  if (header.length < 28) return undefined
  const magic = header.readUInt32LE(0)
  if (magic !== 0xfeedfacf && magic !== 0xfeedface) return undefined
  const arch = CPU_TYPES[header.readUInt32LE(4)] ?? 'other'
  const commands = header.readUInt32LE(16)
  const size = header.readUInt32LE(20)
  const data = read(descriptor, size, offset + (magic === 0xfeedfacf ? 32 : 28))
  let minos: string | undefined
  for (let index = 0, at = 0; index < commands && at + 8 <= data.length; index++) {
    const command = data.readUInt32LE(at)
    const length = data.readUInt32LE(at + 4)
    if (command === LC_BUILD_VERSION && at + 16 <= data.length && data.readUInt32LE(at + 8) === PLATFORM_MACOS) minos = version(data.readUInt32LE(at + 12))
    if (command === LC_VERSION_MIN_MACOSX && at + 12 <= data.length) minos = version(data.readUInt32LE(at + 8))
    if (length < 8) break
    at += length
  }
  return { arch, ...(minos === undefined ? {} : { minos }) }
}

/**
 * Read the architecture slices of a thin or universal Mach-O file.
 * @param path - File to inspect.
 * @returns Undefined for files that are not Mach-O, including Java class files.
 */
export function readMachO(path: string): MachOSlice[] | undefined {
  const descriptor = openSync(path, 'r')
  try {
    const head = read(descriptor, 8, 0)
    if (head.length < 8) return undefined
    const fat = head.readUInt32BE(0)
    if (fat === 0xcafebabe || fat === 0xcafebabf) {
      // Java class files share 0xcafebabe; their version fields read as a large count.
      const count = head.readUInt32BE(4)
      if (count === 0 || count > 16) return undefined
      const entry = fat === 0xcafebabf ? 32 : 20
      const table = read(descriptor, count * entry, 8)
      const slices: MachOSlice[] = []
      for (let index = 0; index < count && (index + 1) * entry <= table.length; index++) {
        const offset = fat === 0xcafebabf ? Number(table.readBigUInt64BE(index * entry + 8)) : table.readUInt32BE(index * entry + 8)
        const slice = thinSlice(descriptor, offset)
        if (slice === undefined) return undefined
        slices.push(slice)
      }
      return slices
    }
    const slice = thinSlice(descriptor, 0)
    return slice === undefined ? undefined : [slice]
  } finally {
    closeSync(descriptor)
  }
}

/** Findings for one packaged macOS application. */
export interface MacAuditReport {
  readonly application: string
  readonly arch: 'x64' | 'arm64'
  readonly images: number
  readonly minimumSystemVersion: string | undefined
  /** Native files without a slice for this architecture; loaders pick another file at run time. */
  readonly otherArchitectures: string[]
  /** Executables that must run on this architecture but lack its slice. */
  readonly wrongArchitecture: string[]
  /** Platform packages installed for another CPU without the one for this CPU. */
  readonly missingPlatformPackages: string[]
  readonly missingOfflineFiles: string[]
  /** Target-architecture images that need a newer macOS than MACOS_MINIMUM. */
  readonly tooNew: Record<string, string[]>
  readonly newest: string | undefined
}

/** Offline content every macOS application must carry, relative to Contents/Resources/workdsh-runtime. */
export const MACOS_OFFLINE_FILES = [
  'primary-runtime/runtime.json',
  'primary-runtime/dependencies/node/bin/node',
  'primary-runtime/dependencies/pnpm/bin/pnpm.mjs',
  'primary-runtime/dependencies/python/bin/python3',
  ...['docx', 'pptx', 'openpyxl', 'xlsxwriter', 'numpy', 'pandas', 'PIL', 'lxml']
    .map(name => `primary-runtime/dependencies/python/lib/python3.12/site-packages/${name}/__init__.py`),
  'office-skills/office-docx/SKILL.md',
  'office-skills/office-pptx/SKILL.md',
  'office-skills/office-xlsx/SKILL.md',
  'office-skills/scripts/check_office.py',
  'package-cache/release-manifest.json',
  'profiles/workdsh/node_modules/@deepseek-ai/dsh/package.json',
  'profiles/workdsh/node_modules/@deepseek-ai/dsh-skill-office/package.json',
  'profiles/workdsh/node_modules/@deepseek-ai/dsh-tool-workspace-dependencies/package.json',
  'profiles/workdsh/node_modules/@deepseek-ai/libreoffice-kit/package.json',
  ...['ppocr_v5_mobile_det.onnx', 'ppocr_v5_mobile_rec.onnx', 'ppocrv5_dict.txt', 'ort/ort-wasm-simd-threaded.wasm']
    .map(name => `profiles/workdsh/node_modules/workdsh-plugin-library/resources/ocr/${name}`),
] as const

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    // Framework version links would list the same file twice.
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}

/**
 * Identify a per-CPU macOS package such as `@scope/tool-darwin-arm64` from its manifest.
 * @param path - A package.json file.
 * @returns The name with its CPU replaced by `*`, and the CPU; undefined for other packages.
 */
export function darwinPlatformPackage(path: string): { key: string, arch: string } | undefined {
  let manifest: { name?: unknown, os?: unknown, cpu?: unknown }
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8')) as typeof manifest
  } catch {
    return undefined
  }
  const match = typeof manifest.name === 'string' ? /^(.*[-/]darwin-)(x64|arm64|universal)$/u.exec(manifest.name) : null
  if (match === null) return undefined
  const cpus = Array.isArray(manifest.cpu) ? manifest.cpu : []
  const arch = cpus.includes('x64') && cpus.includes('arm64') ? 'universal' : match[2]!
  return { key: `${match[1]!}*`, arch }
}

function plistString(plist: string, key: string): string | undefined {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, 'u').exec(plist)?.[1]
}

/**
 * Check that a packaged .app runs on macOS 15 with this architecture: every
 * native image for it needs at most MACOS_MINIMUM, the executables carry its
 * slice, per-CPU platform packages match it, and the offline runtime is complete.
 * @param application - The .app bundle.
 * @param arch - Target architecture.
 * @returns The audit findings.
 */
export function auditMacApplication(application: string, arch: 'x64' | 'arm64'): MacAuditReport {
  const contents = join(application, 'Contents')
  const plist = readFileSync(join(contents, 'Info.plist'), 'utf8')
  const minimumSystemVersion = plistString(plist, 'LSMinimumSystemVersion')
  const executable = plistString(plist, 'CFBundleExecutable') ?? basename(application, '.app')
  const runtime = join(contents, 'Resources', 'workdsh-runtime')
  const missingOfflineFiles: string[] = MACOS_OFFLINE_FILES.filter(path => !existsSync(join(runtime, path)))
  const required = new Set([
    join('Contents', 'MacOS', executable),
    join('Contents', 'Resources', 'workdsh-runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node'),
    join('Contents', 'Resources', 'workdsh-runtime', 'primary-runtime', 'dependencies', 'python', 'bin', 'python3'),
  ])
  const wrongArchitecture: string[] = []
  const otherArchitectures: string[] = []
  const tooNew: Record<string, string[]> = {}
  const platformPackages = new Map<string, Set<string>>()
  let newest: string | undefined
  let images = 0
  let anydocEngine = false
  for (const path of walk(application)) {
    const label = relative(application, path)
    if (basename(path) === `anydoc.darwin-${arch}.node`) anydocEngine = true
    if (basename(path) === 'package.json') {
      const platform = darwinPlatformPackage(path)
      if (platform !== undefined) platformPackages.set(platform.key, (platformPackages.get(platform.key) ?? new Set()).add(platform.arch))
      continue
    }
    const slices = readMachO(path)
    if (slices === undefined) continue
    const slice = slices.find(item => item.arch === arch)
    if (slice === undefined) {
      if (required.has(label)) wrongArchitecture.push(label)
      else otherArchitectures.push(label)
      continue
    }
    images++
    if (slice.minos === undefined) continue
    if (newest === undefined || compareDotted(slice.minos, newest) > 0) newest = slice.minos
    if (compareDotted(slice.minos, MACOS_MINIMUM) > 0) (tooNew[slice.minos] ??= []).push(label)
  }
  for (const path of required) {
    if (!existsSync(join(application, path))) wrongArchitecture.push(path)
  }
  if (!anydocEngine) missingOfflineFiles.push(`AnyDoc engine (@firecrawl/anydoc-darwin-${arch})`)
  const missingPlatformPackages = [...platformPackages]
    .filter(([, arches]) => !arches.has(arch) && !arches.has('universal'))
    .map(([key, arches]) => `${key.replace(/\*$/u, arch)} (found ${[...arches].sort().join(', ')})`)
    .sort()
  if (minimumSystemVersion !== undefined && compareDotted(minimumSystemVersion, MACOS_MINIMUM) > 0) {
    (tooNew[minimumSystemVersion] ??= []).push('Contents/Info.plist (LSMinimumSystemVersion)')
  }
  return {
    application, arch, images, minimumSystemVersion, otherArchitectures: otherArchitectures.sort(),
    wrongArchitecture: wrongArchitecture.sort(), missingPlatformPackages, missingOfflineFiles, tooNew, newest,
  }
}

/**
 * Fail when the application cannot run offline on macOS 15 with its architecture.
 * @param report - Audit findings.
 */
export function assertMacApplication(report: MacAuditReport): void {
  const problems = [
    ...report.missingOfflineFiles.map(path => `missing offline content: ${path}`),
    ...report.wrongArchitecture.map(path => `${path} has no ${report.arch} slice`),
    ...report.missingPlatformPackages.map(name => `missing platform package ${name}`),
    ...Object.entries(report.tooNew).map(([minos, files]) =>
      `macOS ${minos} is newer than ${MACOS_MINIMUM} (needed by ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${String(files.length - 3)} more` : ''})`),
  ]
  if (problems.length > 0) throw new Error(`macOS application audit failed for ${report.application}:\n- ${problems.join('\n- ')}`)
}

/**
 * Locate the one .app that electron-builder wrote below an output directory.
 * @param outputDir - electron-builder output directory.
 * @returns The application path.
 */
export function findMacApplication(outputDir: string): string {
  const apps = readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('mac'))
    .flatMap(entry => readdirSync(join(outputDir, entry.name)).filter(name => name.endsWith('.app')).map(name => join(outputDir, entry.name, name)))
  if (apps.length !== 1) throw new Error(`expected exactly one .app below ${outputDir}; found ${String(apps.length)}`)
  return apps[0]!
}

/**
 * Audit the application electron-builder wrote below an output directory,
 * keeping the report next to the DMG even when the audit fails.
 * @param outputDir - electron-builder output directory.
 * @param arch - Target architecture.
 * @param log - Progress output.
 * @returns The passing report.
 */
export function auditMacOutput(outputDir: string, arch: 'x64' | 'arm64', log: (message: string) => void = message => console.log(message)): MacAuditReport {
  const report = auditMacApplication(findMacApplication(outputDir), arch)
  const reportPath = join(outputDir, 'macos-audit.json')
  writeFileSync(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
  assertMacApplication(report)
  log(`macOS ${MACOS_MINIMUM} audit passed for ${String(report.images)} ${arch} Mach-O images (newest ${report.newest ?? 'unknown'}, LSMinimumSystemVersion ${report.minimumSystemVersion ?? 'unset'}); report: ${reportPath}`)
  return report
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const [application, arch] = process.argv.slice(2)
  if (application === undefined || (arch !== 'x64' && arch !== 'arm64')) {
    throw new Error('Usage: node scripts/macos-compat-audit.ts <App.app> <x64|arm64>')
  }
  const report = auditMacApplication(application, arch)
  process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
  assertMacApplication(report)
}
