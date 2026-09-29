/** Audit a packaged Linux application for Ubuntu 20.04 (glibc 2.31, GCC 10 libstdc++). */

import { closeSync, existsSync, openSync, readSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Newest symbol versions that Ubuntu 20.04 LTS provides. */
export const UBUNTU_2004_SYMBOL_LIMITS: Readonly<Record<string, string>> = {
  GLIBC: '2.31',
  GLIBCXX: '3.4.28',
  CXXABI: '1.3.12',
}

/** ELF e_machine values of the packaged architectures. */
export const ELF_MACHINES: Readonly<Record<'x64' | 'arm64', number>> = { x64: 62, arm64: 183 }

const SHT_GNU_VERNEED = 0x6ffffffe

/**
 * Compare dotted numeric versions.
 * @param left - Version such as `2.28`.
 * @param right - Version such as `2.31`.
 * @returns Negative, zero, or positive like a sort comparator.
 */
export function compareDotted(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Whether one symbol-version requirement is newer than Ubuntu 20.04 provides.
 * @param requirement - Version node such as `GLIBC_2.34`.
 * @returns True when the requirement exceeds the matching limit.
 */
export function exceedsUbuntu2004(requirement: string): boolean {
  const match = /^([A-Z]+)_(\d+(?:\.\d+)*)$/u.exec(requirement)
  if (match === null) return false
  const limit = UBUNTU_2004_SYMBOL_LIMITS[match[1]!]
  return limit !== undefined && compareDotted(match[2]!, limit) > 0
}

function read(descriptor: number, length: number, position: number): Buffer {
  const buffer = Buffer.alloc(length)
  const count = readSync(descriptor, buffer, 0, length, position)
  return buffer.subarray(0, count)
}

function cString(buffer: Buffer, offset: number): string {
  const end = buffer.indexOf(0, offset)
  return buffer.toString('latin1', offset, end < 0 ? buffer.length : end)
}

/**
 * Read the machine and the versioned symbol requirements (`.gnu.version_r`) of an ELF file.
 * @param path - File to inspect.
 * @returns Undefined for non-ELF files; 32-bit or big-endian ELF files report no requirements.
 */
export function readElfVersionNeeds(path: string): { machine: number, needs: string[] } | undefined {
  const descriptor = openSync(path, 'r')
  try {
    const header = read(descriptor, 64, 0)
    if (header.length < 20 || header.readUInt32BE(0) !== 0x7f454c46) return undefined
    const is64LittleEndian = header[4] === 2 && header[5] === 1
    const machine = header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18)
    if (!is64LittleEndian || header.length < 64) return { machine, needs: [] }
    const sectionOffset = Number(header.readBigUInt64LE(0x28))
    const sectionSize = header.readUInt16LE(0x3a)
    const sectionCount = header.readUInt16LE(0x3c)
    if (sectionOffset === 0 || sectionSize < 64 || sectionCount === 0) return { machine, needs: [] }
    const sections = read(descriptor, sectionSize * sectionCount, sectionOffset)
    const section = (index: number): { type: number, offset: number, size: number, link: number, info: number } => {
      const base = index * sectionSize
      return {
        type: sections.readUInt32LE(base + 4),
        offset: Number(sections.readBigUInt64LE(base + 24)),
        size: Number(sections.readBigUInt64LE(base + 32)),
        link: sections.readUInt32LE(base + 40),
        info: sections.readUInt32LE(base + 44),
      }
    }
    const needs = new Set<string>()
    for (let index = 0; (index + 1) * sectionSize <= sections.length; index++) {
      const verneed = section(index)
      if (verneed.type !== SHT_GNU_VERNEED || verneed.link >= sectionCount) continue
      const strings = section(verneed.link)
      const table = read(descriptor, strings.size, strings.offset)
      const data = read(descriptor, verneed.size, verneed.offset)
      let entry = 0
      for (let remaining = verneed.info; remaining > 0 && entry + 16 <= data.length; remaining--) {
        const count = data.readUInt16LE(entry + 2)
        let aux = entry + data.readUInt32LE(entry + 8)
        for (let item = 0; item < count && aux + 16 <= data.length; item++) {
          needs.add(cString(table, data.readUInt32LE(aux + 8)))
          const next = data.readUInt32LE(aux + 12)
          if (next === 0) break
          aux += next
        }
        const next = data.readUInt32LE(entry + 12)
        if (next === 0) break
        entry += next
      }
    }
    return { machine, needs: [...needs].sort() }
  } finally {
    closeSync(descriptor)
  }
}

/** Offline content every Linux package must carry, relative to resources/workdsh-runtime. */
export const LINUX_OFFLINE_FILES = [
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
] as const

/** Findings for one packaged Linux application directory. */
export interface LinuxAuditReport {
  readonly application: string
  readonly arch: 'x64' | 'arm64'
  readonly images: number
  readonly otherArchitectures: string[]
  readonly wrongArchitecture: string[]
  readonly missingOfflineFiles: string[]
  readonly tooNew: Record<string, string[]>
  readonly newest: Record<string, string>
}

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}

/**
 * Check offline completeness, the architecture of the main executables, and
 * that no ELF image of the target architecture needs a newer glibc, libstdc++,
 * or C++ ABI than Ubuntu 20.04 ships.
 * @param application - Unpacked application directory.
 * @param arch - Target architecture.
 * @param executableName - Electron executable name inside the directory.
 * @returns The audit findings.
 */
export function auditLinuxPayload(application: string, arch: 'x64' | 'arm64', executableName = 'workdsh'): LinuxAuditReport {
  const runtime = join(application, 'resources', 'workdsh-runtime')
  const missingOfflineFiles: string[] = LINUX_OFFLINE_FILES.filter(path => !existsSync(join(runtime, path)))
  const expected = ELF_MACHINES[arch]
  const wrongArchitecture = [
    executableName,
    'resources/workdsh-runtime/primary-runtime/dependencies/node/bin/node',
    'resources/workdsh-runtime/primary-runtime/dependencies/python/bin/python3',
  ].filter((path) => {
    const absolute = join(application, path)
    return existsSync(absolute) && readElfVersionNeeds(absolute)?.machine !== expected
  })
  const tooNew: Record<string, string[]> = {}
  const newest: Record<string, string> = {}
  const otherArchitectures: string[] = []
  let images = 0
  // Located by manifest so the check holds for isolated and hoisted pnpm layouts.
  let wasmEngine = false
  for (const path of walk(application)) {
    if (/[\\/]libreoffice-kit-wasm[\\/]package\.json$/u.test(path)) wasmEngine = true
    const elf = readElfVersionNeeds(path)
    if (elf === undefined) continue
    const label = relative(application, path)
    // Prebuilt packages may carry binaries for other architectures that are never loaded here.
    if (elf.machine !== expected) {
      otherArchitectures.push(label)
      continue
    }
    images++
    for (const requirement of elf.needs) {
      const match = /^([A-Z]+)_(\d+(?:\.\d+)*)$/u.exec(requirement)
      if (match === null || UBUNTU_2004_SYMBOL_LIMITS[match[1]!] === undefined) continue
      const current = newest[match[1]!]
      if (current === undefined || compareDotted(match[2]!, current) > 0) newest[match[1]!] = match[2]!
      if (exceedsUbuntu2004(requirement)) (tooNew[requirement] ??= []).push(label)
    }
  }
  if (!wasmEngine) missingOfflineFiles.push('LibreOffice Kit WebAssembly engine (@deepseek-ai/libreoffice-kit-wasm)')
  return { application, arch, images, otherArchitectures: otherArchitectures.sort(), wrongArchitecture, missingOfflineFiles, tooNew, newest }
}

/**
 * Fail when the Linux package cannot run offline on Ubuntu 20.04.
 * @param report - Audit findings.
 */
export function assertLinuxPayload(report: LinuxAuditReport): void {
  const problems = [
    ...report.missingOfflineFiles.map(path => `missing offline content: ${path}`),
    ...report.wrongArchitecture.map(path => `${path} is not a ${report.arch} executable`),
    ...Object.entries(report.tooNew).map(([requirement, files]) =>
      `${requirement} is newer than Ubuntu 20.04 provides (needed by ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${String(files.length - 3)} more` : ''})`),
  ]
  if (problems.length > 0) {
    throw new Error(`Linux package audit failed for ${report.application}:\n- ${problems.join('\n- ')}`)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const [application, arch] = process.argv.slice(2)
  if (application === undefined || (arch !== 'x64' && arch !== 'arm64')) {
    throw new Error('Usage: node scripts/linux-glibc-audit.ts <linux-unpacked> <x64|arm64>')
  }
  const report = auditLinuxPayload(application, arch)
  process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
  assertLinuxPayload(report)
}
