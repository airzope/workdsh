/** Windows 7 x64 policy for the Electron carrier when VxKex NEXT supplies newer Windows APIs. */

/** Host facts that select the Windows 7 policy. */
export interface Windows7Host {
  /** Platform reported by the carrier process. */
  readonly platform: NodeJS.Platform
  /** Kernel version reported by `os.release()`. */
  readonly release: string
  /** Environment inherited by every runtime process the carrier starts. */
  readonly env: NodeJS.ProcessEnv
}

/** Electron settings that must be chosen before the app is ready. */
export interface Windows7Electron {
  disableHardwareAcceleration(): void
}

/** `1` forces the policy on and `0` forces it off, e.g. under strong version spoofing. */
export const WINDOWS7_COMPATIBILITY_OVERRIDE = 'WORKDSH_WINDOWS7_COMPAT'

/**
 * Recognize Windows 7 SP1 and Server 2008 R2 (NT 6.1). VxKex NEXT leaves the
 * PEB version unspoofed for Chromium and Node processes, so the kernel
 * version remains the real one unless the user forces strong spoofing.
 * @param host - Platform, kernel version, and override environment.
 * @returns Whether the Windows 7 policy applies.
 */
export function isWindows7Host(host: Windows7Host): boolean {
  if (host.platform !== 'win32') return false
  const override = host.env[WINDOWS7_COMPATIBILITY_OVERRIDE]
  if (override === '1') return true
  if (override === '0') return false
  return /^6\.1\./u.test(host.release)
}

/**
 * Apply the Windows 7 policy before Electron is ready.
 *
 * The bundled Node.js 24 refuses to start below Windows 10 unless
 * `NODE_SKIP_PLATFORM_CHECK=1` is inherited; VxKex supplies the missing APIs
 * to that child through propagation. Windows 7 has no DirectComposition and
 * current Chromium no longer tests its Windows 7 GPU paths, while a GPU process
 * that keeps failing terminates the whole application, so rendering stays on
 * the software compositor.
 * @param electron - Electron app settings.
 * @param host - Host facts; its environment is updated in place for child processes.
 * @returns Whether the Windows 7 policy was applied.
 */
export function applyWindows7Compatibility(electron: Windows7Electron, host: Windows7Host): boolean {
  if (!isWindows7Host(host)) return false
  host.env.NODE_SKIP_PLATFORM_CHECK = '1'
  electron.disableHardwareAcceleration()
  return true
}
