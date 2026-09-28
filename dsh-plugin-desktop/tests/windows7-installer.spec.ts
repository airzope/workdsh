import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const installer = readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8')
const offlineInstaller = readFileSync(new URL('../build/installer-win7.nsh', import.meta.url), 'utf8')

function macro(name: string): string {
  const match = new RegExp(`^!macro ${name}\\b[\\s\\S]*?^!macroend$`, 'mu').exec(installer)
  if (match === null) throw new Error(`installer.nsh does not define ${name}`)
  return match[0]
}

describe('Windows 7 VxKex NEXT installer integration', () => {
  it('limits every VxKex step to NT 6.1 hosts', () => {
    for (const name of ['customInit', 'customInstall', 'customUnInstall']) {
      expect(macro(name)).toMatch(/\$\{if\} \$\{IsWin7\}\s+\$\{orIf\} \$\{IsWin2008R2\}/u)
    }
  })

  it('stops a standard Windows 7 installation when VxKex NEXT is missing', () => {
    const init = macro('customInit')
    expect(init).toMatch(/!ifndef WORKDSH_BUNDLED_VXKEX[\s\S]*!insertmacro WORKDSH_FIND_KEXCFG \$R0[\s\S]*!endif/u)
    expect(init).toContain('SetErrorLevel 2')
    expect(init).toContain('Quit')
  })

  it('enables VxKex for the exact executable with propagation and Chromium fixes on', () => {
    const install = macro('customInstall')
    expect(install).toContain(
      `'"$R0\\KexCfg.exe" /EXE:"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" /ENABLE:1 /DISABLEFORCHILD:0 /DISABLEAPPSPECIFIC:0'`,
    )
    expect(install).toContain('!insertmacro WORKDSH_FIND_VXKEX_REGISTRATION $R0')
  })

  it('installs the offline payload before registering, then reports missing prerequisites', () => {
    const install = macro('customInstall')
    const order = [
      '!insertmacro WORKDSH_INSTALL_BUNDLED_VCREDIST',
      '!insertmacro WORKDSH_INSTALL_BUNDLED_VXKEX',
      '!insertmacro WORKDSH_FIND_KEXCFG $R0',
      '/ENABLE:1',
      '!insertmacro WORKDSH_WARN_WINDOWS7_PREREQUISITES',
    ].map(step => install.indexOf(step))
    expect(order.every(position => position >= 0)).toBe(true)
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    expect(macro('WORKDSH_INSTALL_BUNDLED_VXKEX')).toContain('ExecShellWait "runas" "$PLUGINSDIR\\VxKexNextSetup.exe" "/SILENTUNATTEND"')
    expect(macro('WORKDSH_INSTALL_BUNDLED_VCREDIST')).toContain('"/install /quiet /norestart"')
  })

  it('builds the offline variant from generated payload definitions', () => {
    expect(offlineInstaller).toContain('!include "${BUILD_RESOURCES_DIR}\\.win7\\offline-payload.nsh"')
    expect(offlineInstaller.indexOf('offline-payload.nsh')).toBeLessThan(offlineInstaller.indexOf('!include "installer.nsh"'))
  })

  it('removes the registration on uninstall but never during an upgrade', () => {
    const uninstall = macro('customUnInstall')
    expect(uninstall).toMatch(/^\s+\$\{ifNot\} \$\{isUpdated\}$/mu)
    expect(uninstall).toContain('/ENABLE:0 /DISABLEFORCHILD:0 /DISABLEAPPSPECIFIC:0 /WINVERSPOOF:NONE /STRONGSPOOF:0')
  })
})
