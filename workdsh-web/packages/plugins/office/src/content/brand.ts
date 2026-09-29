/** Creator written into exported Office files: the white-label product name when the Host sets one. */
export function documentCreator(): string {
  const name = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.WORKDSH_BRAND_NAME?.trim();
  return name && name.length <= 128 ? name : 'WorkDSH';
}
