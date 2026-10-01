import * as React from 'react';
import { LogoMark } from 'workdsh-ui';

/** The product name and mark served by the Host at /api/workdsh-brand. */
export interface ClientBrand {
  readonly name: string;
  /** A data URL, absent for the built-in WorkDSH mark. */
  readonly mark?: string;
}

const brandPath = '/api/workdsh-brand';
const storageKey = 'workdsh.brand';
const fallback: ClientBrand = { name: 'WorkDSH' };
const listeners = new Set<() => void>();

function parse(value: unknown): ClientBrand | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const { name, mark } = value as { name?: unknown; mark?: unknown };
  if (typeof name !== 'string' || !name) return undefined;
  return typeof mark === 'string' && /^data:image\/(?:svg\+xml|png);base64,/u.test(mark) ? { name, mark } : { name };
}

// A white-label build must not flash another product's name; the last brand
// seen on this origin covers the first frame until the Host answers.
let current: ClientBrand | undefined = (() => {
  try { return parse(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); } catch { return undefined; }
})();
let loading: Promise<ClientBrand> | undefined;

/** Fetch the brand once per page; WorkDSH when the Host does not serve one. */
export function loadBrand(): Promise<ClientBrand> {
  loading ??= fetch(brandPath, { credentials: 'same-origin', signal: AbortSignal.timeout(10_000) })
    .then(async response => (response.ok ? parse(await response.json()) : undefined) ?? fallback)
    .catch(() => current ?? fallback)
    .then(brand => {
      current = brand;
      try { localStorage.setItem(storageKey, JSON.stringify(brand)); } catch { /* storage is optional */ }
      for (const listener of listeners) listener();
      return brand;
    });
  return loading;
}

/** The current brand; undefined only before the first answer on a new origin. */
export function useBrand(): ClientBrand | undefined {
  const [, rerender] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => {
    listeners.add(rerender);
    void loadBrand();
    return () => { listeners.delete(rerender); };
  }, []);
  return current;
}

export function BrandName() {
  const brand = useBrand();
  return <span data-testid="workdsh-brand">{brand?.name ?? ''}</span>;
}

/** The brand mark as a square of the size its slot asks for: the sidebar's, or the chat start page's. */
export function BrandMark({ size = 22 }: { readonly size?: number }) {
  const brand = useBrand();
  if (brand === undefined) return <span aria-hidden style={{ display: 'block', width: size, height: size }} />;
  if (brand.mark) return <img src={brand.mark} width={size} height={size} alt="" aria-hidden style={{ display: 'block', objectFit: 'contain' }} />;
  return <LogoMark size={size} />;
}

export function DiagnosticsMark() {
  return <span aria-hidden>W</span>;
}
