import { describe, expect, it } from 'vitest'
import {
  applyWindows7Compatibility,
  isWindows7Host,
  type Windows7Host,
} from '../src/windows7-compatibility.ts'

function host(platform: NodeJS.Platform, release: string, env: NodeJS.ProcessEnv = {}): Windows7Host {
  return { platform, release, env }
}

function electron(): { calls: number, disableHardwareAcceleration: () => void } {
  const recorder = {
    calls: 0,
    disableHardwareAcceleration: () => { recorder.calls += 1 },
  }
  return recorder
}

describe('Windows 7 host detection', () => {
  it('recognizes the NT 6.1 kernel that VxKex leaves unspoofed', () => {
    expect(isWindows7Host(host('win32', '6.1.7601'))).toBe(true)
  })

  it('leaves newer Windows and other platforms on the default policy', () => {
    expect(isWindows7Host(host('win32', '10.0.26200'))).toBe(false)
    expect(isWindows7Host(host('win32', '6.3.9600'))).toBe(false)
    expect(isWindows7Host(host('darwin', '6.1.0'))).toBe(false)
    expect(isWindows7Host(host('linux', '6.1.0-generic'))).toBe(false)
  })

  it('honors an explicit override on Windows only', () => {
    expect(isWindows7Host(host('win32', '10.0.19045', { WORKDSH_WINDOWS7_COMPAT: '1' }))).toBe(true)
    expect(isWindows7Host(host('win32', '6.1.7601', { WORKDSH_WINDOWS7_COMPAT: '0' }))).toBe(false)
    expect(isWindows7Host(host('darwin', '24.0.0', { WORKDSH_WINDOWS7_COMPAT: '1' }))).toBe(false)
  })
})

describe('Windows 7 compatibility policy', () => {
  it('lets bundled Node children start and keeps Chromium on software compositing', () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows\\System32' }
    const app = electron()

    expect(applyWindows7Compatibility(app, host('win32', '6.1.7601', env))).toBe(true)

    expect(env).toEqual({ PATH: 'C:\\Windows\\System32', NODE_SKIP_PLATFORM_CHECK: '1' })
    expect(app.calls).toBe(1)
  })

  it('changes nothing on supported Windows releases', () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows\\System32' }
    const app = electron()

    expect(applyWindows7Compatibility(app, host('win32', '10.0.22631', env))).toBe(false)

    expect(env).toEqual({ PATH: 'C:\\Windows\\System32' })
    expect(app.calls).toBe(0)
  })
})
