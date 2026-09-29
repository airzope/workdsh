/** Resolve the white-label brand a Desktop build uses: names, identifiers and artwork. */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The WorkDSH brand; its values are the build defaults in package.json. */
export const DEFAULT_BRAND_DIRECTORY = join(desktopRoot, 'branding', 'workdsh')
/** Brand-derived files written by `generate-brand.mjs` and packaged with the carrier. */
export const GENERATED_BRAND_DIRECTORY = join(desktopRoot, 'build', 'brand')
/** Selects a brand directory, or its brand.json, relative to the repository root when not absolute. */
export const BRAND_ENVIRONMENT = 'WORKDSH_BRAND'

/** Names and identifiers of a brand; build/brand/brand.json carries them into packaging. */
export interface BrandIdentity {
  /** Display name: window title, shortcuts, menus and the in-app brand. Any language. */
  readonly name: string
  /** ASCII name without spaces for the app bundle, executables, install directory and artifacts. */
  readonly fileName: string
  /** Linux command and Debian package name. */
  readonly executableName: string
  /** Reverse-DNS application identifier; a different one installs side by side. */
  readonly appId: string
  readonly publisher: string
  /** Where users report problems; used in the Debian maintainer field. */
  readonly support: string
  /** One-line Linux summary. */
  readonly summary: string
  readonly description: string
  /** Folder name for user data under the platform's application-data directory. */
  readonly dataDirectory: string
}

/** A validated brand with absolute artwork paths. */
export interface Brand extends BrandIdentity {
  /** Square PNG, at least 512 pixels. */
  readonly logo: string
  /** Optional simplified SVG mark for small sizes and the in-app brand; colors inline, no <style>. */
  readonly mark?: string
  /** Optional accent color (#RRGGBB) for the single-color tray icons drawn from the mark. */
  readonly color?: string
}

const FILE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9_-])?$/u
const EXECUTABLE_NAME = /^[a-z0-9][a-z0-9.+-]{1,63}$/u
const APP_ID = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/u
const TEXT = /^[^\u0000-\u001f\u007f/\\]{1,128}$/u

function text(source: Record<string, unknown>, key: string, pattern: RegExp, where: string): string {
  const value = source[key]
  if (typeof value !== 'string' || !pattern.test(value.trim()) || value.trim() !== value) throw new Error(`${where}: "${key}" is missing or invalid`)
  return value
}

/**
 * Brand directory selected by WORKDSH_BRAND, or the WorkDSH default.
 * @param env - Process environment.
 * @param repositoryRoot - Base for relative selections.
 * @returns The directory that holds brand.json.
 */
export function brandDirectory(env: NodeJS.ProcessEnv = process.env, repositoryRoot = resolve(desktopRoot, '..')): string {
  const selected = env[BRAND_ENVIRONMENT]
  if (selected === undefined || selected.length === 0) return DEFAULT_BRAND_DIRECTORY
  const path = isAbsolute(selected) ? selected : resolve(repositoryRoot, selected)
  return extname(path).toLowerCase() === '.json' ? dirname(path) : path
}

function identity(source: Record<string, unknown>, where: string): BrandIdentity {
  const fileName = text(source, 'fileName', FILE_NAME, where)
  return {
    name: text(source, 'name', TEXT, where),
    fileName,
    executableName: text(source, 'executableName', EXECUTABLE_NAME, where),
    appId: text(source, 'appId', APP_ID, where),
    publisher: text(source, 'publisher', TEXT, where),
    support: text(source, 'support', /^https?:\/\/\S+$/u, where),
    summary: text(source, 'summary', TEXT, where),
    description: text(source, 'description', /^[^\u0000-\u001f\u007f]{1,256}$/u, where),
    dataDirectory: source.dataDirectory === undefined ? fileName : text(source, 'dataDirectory', FILE_NAME, where),
  }
}

/**
 * Read and validate brand.json and its artwork.
 * @param directory - Brand directory.
 * @returns The brand.
 */
export function readBrand(directory: string = brandDirectory()): Brand {
  const where = join(directory, 'brand.json')
  const source = JSON.parse(readFileSync(where, 'utf8')) as Record<string, unknown>
  const artwork = (key: string, extensions: readonly string[]): string | undefined => {
    const value = source[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string' || !extensions.includes(extname(value).toLowerCase())) throw new Error(`${where}: "${key}" must name a ${extensions.join(' or ')} file`)
    const path = resolve(directory, value)
    if (!existsSync(path)) throw new Error(`${where}: "${key}" file ${path} does not exist`)
    return path
  }
  const logo = artwork('logo', ['.png'])
  if (logo === undefined) throw new Error(`${where}: "logo" is required`)
  const mark = artwork('mark', ['.svg'])
  const color = source.color === undefined ? undefined : text(source, 'color', /^#[0-9A-Fa-f]{6}$/u, where)
  return {
    ...identity(source, where),
    logo,
    ...(mark === undefined ? {} : { mark }),
    ...(color === undefined ? {} : { color }),
  }
}

/**
 * The brand a Desktop build generated into build/brand. Packaging and its
 * verifiers follow the build rather than the environment, so one build cannot
 * be packaged under another brand's names. Without a generated brand (focused
 * tests with a synthetic package root) this is the WorkDSH brand.
 * @param root - Desktop package root.
 * @returns The built brand's names and identifiers.
 */
export function builtBrand(root: string = desktopRoot): BrandIdentity {
  const where = join(root, 'build', 'brand', 'brand.json')
  if (!existsSync(where)) return readBrand(DEFAULT_BRAND_DIRECTORY)
  return identity(JSON.parse(readFileSync(where, 'utf8')) as Record<string, unknown>, where)
}

/**
 * electron-builder overrides that turn the package.json defaults (the WorkDSH
 * brand) into this brand. The default brand needs none.
 * @param brand - Selected brand.
 * @param defaults - The WorkDSH brand.
 * @returns `--config.*` arguments.
 */
export function brandBuilderOverrides(brand: BrandIdentity, defaults: BrandIdentity = readBrand(DEFAULT_BRAND_DIRECTORY)): string[] {
  const args: string[] = []
  const set = (key: string, value: string): void => { args.push(`--config.${key}=${value}`) }
  if (brand.fileName !== defaults.fileName) {
    set('productName', brand.fileName)
    set('mac.artifactName', `${brand.fileName}-\${version}-\${arch}.\${ext}`)
    set('nsis.artifactName', `${brand.fileName}-\${version}-\${arch}-Setup.\${ext}`)
    set('win.artifactName', `${brand.fileName}-\${version}-\${arch}-Portable.\${ext}`)
    set('linux.artifactName', `${brand.fileName}-\${version}-linux-\${arch}.\${ext}`)
  }
  if (brand.name !== defaults.name || brand.fileName !== defaults.fileName) {
    set('nsis.shortcutName', brand.name)
    set('nsis.uninstallDisplayName', `${brand.name} \${version}`)
    set('mac.extendInfo.CFBundleDisplayName', brand.name)
    set('linux.desktop.entry.Name', brand.name)
  }
  if (brand.appId !== defaults.appId) set('appId', brand.appId)
  if (brand.executableName !== defaults.executableName) {
    set('linux.executableName', brand.executableName)
    set('deb.packageName', brand.executableName)
    set('extraMetadata.desktopName', `${brand.executableName}.desktop`)
  }
  if (brand.publisher !== defaults.publisher || brand.support !== defaults.support) {
    set('linux.maintainer', `${brand.publisher} <${brand.support}>`)
    set('copyright', `Copyright © ${brand.publisher}`)
    set('extraMetadata.author', brand.publisher)
  }
  if (brand.summary !== defaults.summary) set('linux.synopsis', brand.summary)
  if (brand.description !== defaults.description) set('extraMetadata.description', brand.description)
  return args
}
