/** Audit a packaged Windows application for Windows 7 x64 under VxKex NEXT. */

import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * DLL names that VxKex NEXT 1.2.3.2463 rewrites to its own implementations
 * (KexDll/redirects.h). API-set names omit their `-lX-Y-Z` suffix.
 */
export const VXKEX_REDIRECTED_DLLS: ReadonlySet<string> = new Set([
  'advapi32', 'api-ms-win-appmodel-identity', 'api-ms-win-appmodel-runtime', 'api-ms-win-core-apiquery',
  'api-ms-win-core-atoms', 'api-ms-win-core-com', 'api-ms-win-core-com-midlproxystub',
  'api-ms-win-core-com-private', 'api-ms-win-core-console', 'api-ms-win-core-crt',
  'api-ms-win-core-datetime', 'api-ms-win-core-debug', 'api-ms-win-core-delayload',
  'api-ms-win-core-errorhandling', 'api-ms-win-core-featurestaging', 'api-ms-win-core-fibers',
  'api-ms-win-core-file', 'api-ms-win-core-handle', 'api-ms-win-core-heap', 'api-ms-win-core-heap-obsolete',
  'api-ms-win-core-interlocked', 'api-ms-win-core-io', 'api-ms-win-core-job',
  'api-ms-win-core-kernel32-legacy', 'api-ms-win-core-largeinteger', 'api-ms-win-core-libraryloader',
  'api-ms-win-core-localization', 'api-ms-win-core-localization-ansi',
  'api-ms-win-core-localization-obsolete', 'api-ms-win-core-localregistry', 'api-ms-win-core-marshal',
  'api-ms-win-core-memory', 'api-ms-win-core-namedpipe', 'api-ms-win-core-namedpipe-ansi',
  'api-ms-win-core-normalization', 'api-ms-win-core-path', 'api-ms-win-core-privateprofile',
  'api-ms-win-core-processenvironment', 'api-ms-win-core-processsnapshot', 'api-ms-win-core-processthreads',
  'api-ms-win-core-processtopology', 'api-ms-win-core-processtopology-obsolete', 'api-ms-win-core-profile',
  'api-ms-win-core-psapi', 'api-ms-win-core-quirks', 'api-ms-win-core-realtime', 'api-ms-win-core-registry',
  'api-ms-win-core-registry-private', 'api-ms-win-core-registryuserspecific', 'api-ms-win-core-rtlsupport',
  'api-ms-win-core-shlwapi-legacy', 'api-ms-win-core-shlwapi-obsolete', 'api-ms-win-core-sidebyside',
  'api-ms-win-core-string', 'api-ms-win-core-string-obsolete', 'api-ms-win-core-stringansi',
  'api-ms-win-core-synch', 'api-ms-win-core-synch-ansi', 'api-ms-win-core-sysinfo',
  'api-ms-win-core-systemtopology', 'api-ms-win-core-threadpool', 'api-ms-win-core-threadpool-legacy',
  'api-ms-win-core-threadpool-private', 'api-ms-win-core-timezone', 'api-ms-win-core-toolhelp',
  'api-ms-win-core-url', 'api-ms-win-core-util', 'api-ms-win-core-version', 'api-ms-win-core-versionansi',
  'api-ms-win-core-windowserrorreporting', 'api-ms-win-core-winrt', 'api-ms-win-core-winrt-error',
  'api-ms-win-core-winrt-errorprivate', 'api-ms-win-core-winrt-registration',
  'api-ms-win-core-winrt-robuffer', 'api-ms-win-core-winrt-roparameterizediid',
  'api-ms-win-core-winrt-string', 'api-ms-win-core-wow64', 'api-ms-win-core-xstate', 'api-ms-win-crt-conio',
  'api-ms-win-crt-convert', 'api-ms-win-crt-environment', 'api-ms-win-crt-filesystem', 'api-ms-win-crt-heap',
  'api-ms-win-crt-locale', 'api-ms-win-crt-math', 'api-ms-win-crt-multibyte', 'api-ms-win-crt-private',
  'api-ms-win-crt-process', 'api-ms-win-crt-runtime', 'api-ms-win-crt-stdio', 'api-ms-win-crt-string',
  'api-ms-win-crt-time', 'api-ms-win-crt-utility', 'api-ms-win-devices-config', 'api-ms-win-devices-query',
  'api-ms-win-devices-swdevice', 'api-ms-win-downlevel-kernel32', 'api-ms-win-downlevel-ole32',
  'api-ms-win-downlevel-shell32', 'api-ms-win-eventing-classicprovider', 'api-ms-win-eventing-consumer',
  'api-ms-win-eventing-controller', 'api-ms-win-eventing-legacy', 'api-ms-win-eventing-provider',
  'api-ms-win-eventlog-legacy', 'api-ms-win-kernel32-package-current', 'api-ms-win-mm-time',
  'api-ms-win-ntuser-sysparams', 'api-ms-win-power-base', 'api-ms-win-power-setting',
  'api-ms-win-security-base', 'api-ms-win-security-base-ansi', 'api-ms-win-security-cryptoapi',
  'api-ms-win-security-lsalookup', 'api-ms-win-security-lsalookup-ansi', 'api-ms-win-security-sddl',
  'api-ms-win-security-sddl-ansi', 'api-ms-win-security-systemfunctions', 'api-ms-win-service-core',
  'api-ms-win-service-core-ansi', 'api-ms-win-service-management', 'api-ms-win-service-private',
  'api-ms-win-service-winsvc', 'api-ms-win-shcore-comhelpers', 'api-ms-win-shcore-obsolete',
  'api-ms-win-shcore-path', 'api-ms-win-shcore-registry', 'api-ms-win-shcore-scaling',
  'api-ms-win-shcore-stream', 'api-ms-win-shcore-stream-winrt', 'api-ms-win-shcore-sysinfo',
  'api-ms-win-shcore-taskpool', 'api-ms-win-shcore-thread', 'api-ms-win-shcore-unicodeansi',
  'api-ms-win-shell-namespace', 'bcrypt', 'bcryptprimitives', 'bluetoothapis', 'cfgmgr32', 'combase',
  'coremessaging', 'd2d1', 'd3d11', 'd3d12', 'dcomp', 'dnsapi', 'dxgi', 'ext-ms-win-branding-winbrand',
  'ext-ms-win-gdi-dc', 'ext-ms-win-gdi-dc-create', 'ext-ms-win-gdi-draw', 'ext-ms-win-gdi-font',
  'ext-ms-win-gdi-path', 'ext-ms-win-ntuser-draw', 'ext-ms-win-ntuser-rotationmanager',
  'ext-ms-win-ntuser-windowclass', 'ext-ms-win-rtcore-gdi-devcaps', 'ext-ms-win-rtcore-gdi-object',
  'ext-ms-win-rtcore-gdi-rgn', 'ext-ms-win-rtcore-ntuser-sysparams', 'ext-ms-win-uiacore', 'kernel32',
  'kernelbase', 'mfplat', 'msvcrt', 'ncrypt', 'ntdll', 'ole32', 'powrprof', 'schannel', 'secur32',
  'security', 'shcore', 'sspicli', 'uiautomationcore', 'user32', 'userenv', 'version',
  'windows.system.launcher', 'winhttp', 'wldp', 'ws2_32', 'wtsapi32', 'xinput1_4',
])

/** VxKex NEXT's prebuilt DLLs, found through its DLL search path. */
const VXKEX_PREBUILT_DLLS = ['ucrtbase', 'msvcp_win', 'dwrw10', 'icuuc', 'mfdevmgr', 'mshtmlmedia']

/** Microsoft VC++ 2015-2022 runtime, installed centrally by the offline installer. */
export const VC_RUNTIME_DLLS: ReadonlySet<string> = new Set([
  'concrt140', 'msvcp140', 'msvcp140_1', 'msvcp140_2', 'msvcp140_atomic_wait', 'msvcp140_codecvt_ids',
  'vccorlib140', 'vcomp140', 'vcruntime140', 'vcruntime140_1',
])

/**
 * System DLLs present on Windows 7 SP1 x64 with KB2533623 and KB2670838.
 * Only static imports are checked; delay-loaded imports are resolved when used.
 */
export const WINDOWS7_SYSTEM_DLLS: ReadonlySet<string> = new Set([
  'activeds', 'apphelp', 'audioses', 'authz', 'avicap32', 'avrt', 'bcrypt', 'bthprops.cpl', 'cabinet', 'cfgmgr32',
  'comctl32', 'comdlg32', 'credui', 'crypt32', 'cryptbase', 'cryptsp', 'd2d1', 'd3d10', 'd3d10_1', 'd3d11', 'd3d9',
  'dbgeng', 'dbghelp', 'dciman32', 'ddraw', 'devobj', 'dhcpcsvc', 'dhcpcsvc6', 'dinput8', 'dnsapi', 'dsound', 'dwmapi',
  'dwrite', 'dxgi', 'dxva2', 'esent', 'evr', 'fwpuclnt', 'gdi32', 'gdiplus', 'glu32', 'hid', 'hlink', 'icmp',
  'iertutil', 'imagehlp', 'imm32', 'iphlpapi', 'kernel32', 'ksuser', 'ktmw32', 'loadperf', 'logoncli', 'mf',
  'mfplat', 'mfplay', 'mfreadwrite', 'mmdevapi', 'mpr', 'msacm32', 'mscms', 'msctf', 'msi', 'msimg32', 'msvcrt',
  'msvfw32', 'mswsock', 'ncrypt', 'netapi32', 'netutils', 'normaliz', 'nsi', 'ntdll', 'ntdsapi', 'ntmarta',
  'odbc32', 'ole32', 'oleacc', 'oleaut32', 'oledlg', 'olepro32', 'opengl32', 'pdh', 'powrprof', 'profapi',
  'propsys', 'psapi', 'rasapi32', 'rpcrt4', 'rstrtmgr', 'samcli', 'schannel', 'secur32', 'sechost', 'sensapi',
  'setupapi', 'shell32', 'shfolder', 'shlwapi', 'slc', 'snmpapi', 'srvcli', 'sspicli', 'sxs', 'tapi32', 'traffic',
  'uiautomationcore', 'urlmon', 'user32', 'userenv', 'usp10', 'uxtheme', 'version', 'virtdisk', 'vssapi', 'wer',
  'wevtapi', 'windowscodecs', 'winhttp', 'wininet', 'winmm', 'winscard', 'winspool.drv', 'winsta', 'wintrust',
  'winusb', 'wkscli', 'wlanapi', 'wldap32', 'ws2_32', 'wsock32', 'wtsapi32', 'xinput9_1_0', 'xmllite',
])

const PE_EXTENSIONS = /\.(?:exe|dll|node|pyd)$/iu
const IMAGE_FILE_MACHINE_AMD64 = 0x8664

/**
 * Normalize an imported DLL name the way VxKex NEXT matches its rewrite table.
 * @param dll - Imported module name.
 * @returns Lower-case name without `.dll`, and without the `-lX-Y-Z` suffix for API sets.
 */
export function vxkexDllKey(dll: string): string {
  let name = dll.toLowerCase()
  if (name.endsWith('.dll')) name = name.slice(0, -4)
  if (name.startsWith('api-') || name.startsWith('ext-')) name = name.slice(0, -7)
  return name
}

/**
 * Explain how Windows 7 with VxKex NEXT resolves one static import.
 * @param dll - Imported module name.
 * @param shipped - Lower-case module names shipped anywhere in the payload.
 * @returns The resolving party, or undefined when nothing provides it.
 */
export function resolveWindows7Import(dll: string, shipped: ReadonlySet<string>): string | undefined {
  const lower = dll.toLowerCase()
  const bare = lower.endsWith('.dll') ? lower.slice(0, -4) : lower
  if (shipped.has(lower)) return 'payload'
  if (VC_RUNTIME_DLLS.has(bare)) return 'vc-runtime'
  if (VXKEX_REDIRECTED_DLLS.has(vxkexDllKey(lower)) || VXKEX_PREBUILT_DLLS.includes(bare)) return 'vxkex'
  if (WINDOWS7_SYSTEM_DLLS.has(bare)) return 'windows7'
  return undefined
}

function read(descriptor: number, length: number, position: number): Buffer {
  const buffer = Buffer.alloc(length)
  const count = readSync(descriptor, buffer, 0, length, position)
  return buffer.subarray(0, count)
}

/**
 * Read the machine type and statically imported DLL names of a PE image.
 * @param path - Executable, DLL, Node addon, or Python extension.
 * @returns Undefined for files that are not PE images.
 */
export function readPeImports(path: string): { machine: number, imports: string[] } | undefined {
  const descriptor = openSync(path, 'r')
  try {
    const dos = read(descriptor, 64, 0)
    if (dos.length < 64 || dos.toString('latin1', 0, 2) !== 'MZ') return undefined
    const pe = dos.readUInt32LE(0x3c)
    const header = read(descriptor, 24, pe)
    if (header.length < 24 || header.toString('latin1', 0, 4) !== 'PE\0\0') return undefined
    const machine = header.readUInt16LE(4)
    const sectionCount = header.readUInt16LE(6)
    const optionalSize = header.readUInt16LE(20)
    const optional = read(descriptor, optionalSize, pe + 24)
    const magic = optional.readUInt16LE(0)
    const directories = magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1
    if (directories < 0 || optional.length < directories + 16) return { machine, imports: [] }
    const importRva = optional.readUInt32LE(directories + 8)
    const sections = read(descriptor, sectionCount * 40, pe + 24 + optionalSize)
    const offsetOf = (rva: number): number | undefined => {
      for (let index = 0; index + 40 <= sections.length; index += 40) {
        const size = Math.max(sections.readUInt32LE(index + 8), sections.readUInt32LE(index + 16))
        const address = sections.readUInt32LE(index + 12)
        if (rva >= address && rva < address + size) return rva - address + sections.readUInt32LE(index + 20)
      }
      return undefined
    }
    const imports: string[] = []
    const first = importRva === 0 ? undefined : offsetOf(importRva)
    for (let entry = 0; first !== undefined && entry < 4096; entry++) {
      const record = read(descriptor, 20, first + entry * 20)
      if (record.length < 20 || record.every(byte => byte === 0)) break
      const nameOffset = offsetOf(record.readUInt32LE(12))
      if (nameOffset === undefined) continue
      const name = read(descriptor, 260, nameOffset)
      const end = name.indexOf(0)
      imports.push(name.toString('latin1', 0, end < 0 ? name.length : end))
    }
    return { machine, imports }
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Imports a GPU driver provides, allowed only for the run-time-loaded image
 * that needs them: ggml loads its Vulkan backend dynamically and skips it
 * when no driver installed the Vulkan loader.
 */
export const DRIVER_PROVIDED_IMPORTS: Readonly<Record<string, RegExp>> = {
  'vulkan-1.dll': /(?:^|\/)llama\/bin\/ggml-vulkan\.dll$/iu,
}

/** Findings for one packaged application directory. */
export interface Windows7AuditReport {
  readonly application: string
  readonly images: number
  readonly skippedNonX64: string[]
  readonly missingOfflineFiles: string[]
  readonly unresolvedImports: Record<string, string[]>
  readonly resolvedBy: Record<string, string[]>
}

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}

/** Offline content every Windows 7 package must carry, relative to resources/workdsh-runtime. */
export const WINDOWS7_OFFLINE_FILES = [
  'primary-runtime/runtime.json',
  'primary-runtime/dependencies/node/bin/node.exe',
  'primary-runtime/dependencies/pnpm/bin/pnpm.mjs',
  'primary-runtime/dependencies/python/python.exe',
  ...['docx', 'pptx', 'openpyxl', 'xlsxwriter', 'numpy', 'pandas', 'PIL', 'lxml']
    .map(name => `primary-runtime/dependencies/python/Lib/site-packages/${name}/__init__.py`),
  'office-skills/office-docx/SKILL.md',
  'office-skills/office-pptx/SKILL.md',
  'office-skills/office-xlsx/SKILL.md',
  'office-skills/scripts/check_office.py',
  'media/manifest.json',
  'media/bin/ffmpeg.exe',
  'media/bin/ffprobe.exe',
  'llama/manifest.json',
  'llama/LICENSE',
  'llama/bin/llama-server.exe',
  'llama/bin/msvcp140.dll',
  'llama/bin/vcruntime140.dll',
  'llama/bin/vcruntime140_1.dll',
  'package-cache/release-manifest.json',
  'profiles/workdsh/node_modules/@deepseek-ai/dsh/package.json',
  'profiles/workdsh/node_modules/@deepseek-ai/dsh-skill-office/package.json',
  'profiles/workdsh/node_modules/@deepseek-ai/dsh-tool-workspace-dependencies/package.json',
  'profiles/workdsh/node_modules/@deepseek-ai/libreoffice-kit/package.json',
  ...['ppocr_v5_mobile_det.onnx', 'ppocr_v5_mobile_rec.onnx', 'ppocrv5_dict.txt', 'ort/ort-wasm-simd-threaded.wasm']
    .map(name => `profiles/workdsh/node_modules/workdsh-plugin-library/resources/ocr/${name}`),
] as const

/**
 * Check that the Windows 7 package is complete offline and that every static
 * import of every x64 image resolves on Windows 7 SP1 with VxKex NEXT.
 * @param application - Unpacked application directory (win-unpacked).
 * @returns The audit findings.
 */
export function auditWindows7Payload(application: string): Windows7AuditReport {
  const runtime = join(application, 'resources', 'workdsh-runtime')
  const missingOfflineFiles: string[] = WINDOWS7_OFFLINE_FILES.filter(path => !existsSync(join(runtime, path)))
  const files = [...walk(application)]
  const engines = files.filter(path => basename(path).toLowerCase() === 'libreoffice-kit.exe' && basename(dirname(path)) === 'bin')
  if (engines.length === 0) missingOfflineFiles.push('LibreOffice Kit engine (bin/libreoffice-kit.exe)')
  if (!files.some(path => basename(path).toLowerCase() === 'anydoc.win32-x64-msvc.node')) missingOfflineFiles.push('AnyDoc engine (@firecrawl/anydoc-win32-x64-msvc)')
  const images = files.filter(path => PE_EXTENSIONS.test(path) && statSync(path).size > 0)
  const shipped = new Set(images.map(path => basename(path).toLowerCase()))
  const unresolvedImports: Record<string, string[]> = {}
  const resolvedBy: Record<string, string[]> = {}
  const skippedNonX64: string[] = []
  let scanned = 0
  for (const image of images) {
    const parsed = readPeImports(image)
    if (parsed === undefined) continue
    const label = relative(application, image).replaceAll('\\', '/')
    if (parsed.machine !== IMAGE_FILE_MACHINE_AMD64) {
      skippedNonX64.push(label)
      continue
    }
    scanned++
    for (const dll of parsed.imports) {
      const key = dll.toLowerCase()
      const owner = resolveWindows7Import(dll, shipped) ?? (DRIVER_PROVIDED_IMPORTS[key]?.test(label) === true ? 'gpu-driver' : undefined)
      if (owner === undefined) (unresolvedImports[key] ??= []).push(label)
      else if (!(resolvedBy[owner] ??= []).includes(key)) resolvedBy[owner]!.push(key)
    }
  }
  for (const names of Object.values(resolvedBy)) names.sort()
  return { application, images: scanned, skippedNonX64: skippedNonX64.sort(), missingOfflineFiles, unresolvedImports, resolvedBy }
}

/**
 * Fail when the audit found missing offline content or unresolved imports.
 * @param report - Audit findings.
 */
export function assertWindows7Payload(report: Windows7AuditReport): void {
  const problems = [
    ...report.missingOfflineFiles.map(path => `missing offline content: ${path}`),
    ...Object.entries(report.unresolvedImports).map(([dll, importers]) =>
      `${dll} is neither shipped, provided by VxKex NEXT, the VC++ runtime, nor Windows 7 (imported by ${importers.slice(0, 3).join(', ')}${importers.length > 3 ? ` and ${String(importers.length - 3)} more` : ''})`),
  ]
  if (problems.length > 0) {
    throw new Error(`Windows 7 package audit failed for ${report.application}:\n- ${problems.join('\n- ')}`)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const application = process.argv[2]
  if (application === undefined) throw new Error('Usage: node scripts/windows7-payload-audit.ts <win-unpacked>')
  const report = auditWindows7Payload(application)
  process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
  assertWindows7Payload(report)
}
