import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_BRAND_DIRECTORY,
  brandBuilderOverrides,
  brandDirectory,
  builtBrand,
  readBrand,
} from '../scripts/brand.ts'
import { MAC_APP_ICON_INSET, WINDOWS_APP_ICON_SIZES, recolorMark, writeBrandAssets } from '../scripts/generate-brand.ts'
import { brandEnvironment, readPackagedBrand, unpackedPath } from '../src/brand.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-brand-'))
  roots.push(root)
  return root
}

const workdsh = JSON.parse(readFileSync(join(DEFAULT_BRAND_DIRECTORY, 'brand.json'), 'utf8')) as Record<string, unknown>

/** A custom brand with an 8-bit 600px logo and no mark. */
async function customBrand(fields: Record<string, unknown> = {}): Promise<string> {
  const root = temporary()
  await sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } })
    .png().toFile(join(root, 'logo.png'))
  writeFileSync(join(root, 'brand.json'), JSON.stringify({
    name: '智办', fileName: 'AcmeDesk', executableName: 'acmedesk', appId: 'com.acme.desk',
    publisher: 'Acme Ltd', support: 'https://acme.example/support', summary: 'Acme workspace',
    description: 'Acme desktop workspace', logo: 'logo.png', ...fields,
  }))
  return root
}

describe('brand configuration', () => {
  it('uses the WorkDSH brand by default, which needs no electron-builder overrides', () => {
    const brand = readBrand(DEFAULT_BRAND_DIRECTORY)
    expect(brand).toMatchObject({ name: 'WorkDSH', fileName: 'WorkDSH', executableName: 'workdsh', dataDirectory: 'WorkDSH', color: '#176BFF' })
    expect(brand.mark).toBe(join(DEFAULT_BRAND_DIRECTORY, 'mark.svg'))
    expect(brandBuilderOverrides(brand)).toEqual([])
    expect(brandDirectory({})).toBe(DEFAULT_BRAND_DIRECTORY)
  })

  it('selects a brand directory or brand.json relative to the repository', () => {
    expect(brandDirectory({ WORKDSH_BRAND: 'branding/acme' }, '/repo')).toBe(resolve('/repo', 'branding', 'acme'))
    const absolute = resolve('/brands', 'acme', 'brand.json')
    expect(brandDirectory({ WORKDSH_BRAND: absolute }, '/repo')).toBe(dirname(absolute))
  })

  it('turns a custom brand into electron-builder overrides', async () => {
    const brand = readBrand(await customBrand())
    expect(brand.dataDirectory).toBe('AcmeDesk')
    expect(brandBuilderOverrides(brand)).toEqual([
      '--config.productName=AcmeDesk',
      '--config.mac.artifactName=AcmeDesk-${version}-${arch}.${ext}',
      '--config.nsis.artifactName=AcmeDesk-${version}-${arch}-Setup.${ext}',
      '--config.win.artifactName=AcmeDesk-${version}-${arch}-Portable.${ext}',
      '--config.linux.artifactName=AcmeDesk-${version}-linux-${arch}.${ext}',
      '--config.nsis.shortcutName=智办',
      '--config.nsis.uninstallDisplayName=智办 ${version}',
      '--config.mac.extendInfo.CFBundleDisplayName=智办',
      '--config.linux.desktop.entry.Name=智办',
      '--config.appId=com.acme.desk',
      '--config.linux.executableName=acmedesk',
      '--config.deb.packageName=acmedesk',
      '--config.extraMetadata.desktopName=acmedesk.desktop',
      '--config.linux.maintainer=Acme Ltd <https://acme.example/support>',
      '--config.copyright=Copyright © Acme Ltd',
      '--config.extraMetadata.author=Acme Ltd',
      '--config.linux.synopsis=Acme workspace',
      '--config.extraMetadata.description=Acme desktop workspace',
    ])
  })

  it('rejects names that cannot become files, packages or identifiers', async () => {
    await expect(customBrand({ fileName: 'Acme Desk' }).then(readBrand)).rejects.toThrow(/"fileName" is missing or invalid/u)
    await expect(customBrand({ executableName: 'Acme' }).then(readBrand)).rejects.toThrow(/"executableName"/u)
    await expect(customBrand({ appId: 'acme' }).then(readBrand)).rejects.toThrow(/"appId"/u)
    await expect(customBrand({ logo: 'missing.png' }).then(readBrand)).rejects.toThrow(/does not exist/u)
    await expect(customBrand({ mark: 'logo.png' }).then(readBrand)).rejects.toThrow(/"mark" must name a \.svg file/u)
    await expect(customBrand({ color: 'blue' }).then(readBrand)).rejects.toThrow(/"color"/u)
  })

  it('reads the built brand, or WorkDSH for a package root without a build', () => {
    const root = temporary()
    expect(builtBrand(root).fileName).toBe('WorkDSH')
    mkdirSync(join(root, 'build', 'brand'), { recursive: true })
    writeFileSync(join(root, 'build', 'brand', 'brand.json'), JSON.stringify({ ...workdsh, fileName: 'AcmeDesk', mark: 'mark.svg' }))
    expect(builtBrand(root)).toMatchObject({ name: 'WorkDSH', fileName: 'AcmeDesk', dataDirectory: 'WorkDSH' })
  })
})

describe('generated brand files', () => {
  it('recolors inline mark colors and refuses styled SVG', () => {
    const mark = '<svg fill="none"><path stroke="#176BFF"/><path fill="#18CFE7"/></svg>'
    expect(recolorMark(mark, '#000000')).toBe('<svg fill="none"><path stroke="#000000"/><path fill="#000000"/></svg>')
    expect(recolorMark(mark, undefined)).toBe(mark)
    expect(() => recolorMark('<svg><style>path{fill:red}</style></svg>', '#000000')).toThrow(/not styles/u)
  })

  it('writes every icon, tray bitmap and the packaged brand for a brand without a mark', async () => {
    const output = join(temporary(), 'brand')
    const packaged = await writeBrandAssets(readBrand(await customBrand()), output)

    expect(packaged).toMatchObject({ name: '智办', fileName: 'AcmeDesk', dataDirectory: 'AcmeDesk', mark: 'mark.png' })
    expect(readPackagedBrand(output)).toEqual({ ...packaged })
    expect(await sharp(join(output, 'app-icon.png')).metadata()).toMatchObject({ width: 1024, height: 1024 })
    expect(await sharp(join(output, 'mark.png')).metadata()).toMatchObject({ width: 256, height: 256 })
    const mac = sharp(join(output, 'app-icon-mac.png'))
    expect(await mac.metadata()).toMatchObject({ width: 1024, height: 1024, depth: 'ushort' })
    const corner = await mac.extract({ left: 0, top: 0, width: MAC_APP_ICON_INSET, height: MAC_APP_ICON_INSET }).raw().toBuffer()
    expect(corner.every((_value, index) => index % 8 < 6 || corner[index] === 0)).toBe(true)
    const ico = readFileSync(join(output, 'app-icon.ico'))
    expect(ico.readUInt16LE(4)).toBe(WINDOWS_APP_ICON_SIZES.length)
    const template = await sharp(join(output, 'tray-iconTemplate.png')).raw().toBuffer({ resolveWithObject: true })
    expect(template.info).toMatchObject({ width: 16, height: 16, channels: 4 })
    expect(template.data.every((value, index) => index % 4 === 3 || value === 0)).toBe(true)
  })
})

describe('packaged brand at run time', () => {
  it('points the runtime at the unpacked mark', () => {
    expect(unpackedPath('/Applications/AcmeDesk.app/Contents/Resources/app.asar/build/brand/mark.svg'))
      .toBe('/Applications/AcmeDesk.app/Contents/Resources/app.asar.unpacked/build/brand/mark.svg')
    expect(unpackedPath('C:\\Apps\\AcmeDesk\\resources\\app.asar\\build\\brand\\mark.svg'))
      .toBe('C:\\Apps\\AcmeDesk\\resources\\app.asar.unpacked\\build\\brand\\mark.svg')
    expect(unpackedPath('/repo/dsh-plugin-desktop/build/brand/mark.svg')).toBe('/repo/dsh-plugin-desktop/build/brand/mark.svg')
    expect(brandEnvironment({ name: '智办', fileName: 'AcmeDesk', dataDirectory: 'AcmeDesk', mark: 'mark.png' }, '/opt/AcmeDesk/resources/app.asar/build/brand'))
      .toEqual({ WORKDSH_BRAND_NAME: '智办', WORKDSH_BRAND_MARK: join('/opt/AcmeDesk/resources/app.asar.unpacked/build/brand', 'mark.png') })
  })

  it('rejects a packaged brand without its fields', () => {
    const root = temporary()
    writeFileSync(join(root, 'brand.json'), JSON.stringify({ name: 'WorkDSH', fileName: 'WorkDSH', dataDirectory: 'WorkDSH', mark: '../x' }))
    expect(() => readPackagedBrand(root)).toThrow(/unexpected mark file/u)
    writeFileSync(join(root, 'brand.json'), JSON.stringify({ name: 'WorkDSH' }))
    expect(() => readPackagedBrand(root)).toThrow(/has no fileName/u)
  })
})
