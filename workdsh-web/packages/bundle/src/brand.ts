import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';

export const brandPath = '/api/workdsh-brand';
export const defaultBrandName = 'WorkDSH';
const maxMarkBytes = 256 * 1024;
const markTypes: Readonly<Record<string, string>> = { '.svg': 'image/svg+xml', '.png': 'image/png' };

/** The product name and mark the Web UI shows. */
export interface ProductBrand {
  name: string;
  /** A data URL, absent for the built-in WorkDSH mark. */
  mark?: string;
}

/**
 * The brand a white-label Desktop build passes to its runtime in
 * WORKDSH_BRAND_NAME and WORKDSH_BRAND_MARK; WorkDSH when they are unset or invalid.
 * @param env - Host process environment.
 * @returns The brand.
 */
export function readProductBrand(env: NodeJS.ProcessEnv = process.env): ProductBrand {
  const name = env.WORKDSH_BRAND_NAME?.trim();
  const brand: ProductBrand = { name: name && name.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(name) ? name : defaultBrandName };
  const path = env.WORKDSH_BRAND_MARK;
  const type = path ? markTypes[extname(path).toLowerCase()] : undefined;
  if (!path || !type) return brand;
  try {
    if (statSync(path).size > maxMarkBytes) return brand;
    return { ...brand, mark: `data:${type};base64,${readFileSync(path).toString('base64')}` };
  } catch {
    return brand;
  }
}

/** Serve the brand to the Web UI. */
export function registerBrand(ctx: Context, brand: ProductBrand = readProductBrand()): void {
  const connection = (ctx as Context & { connection: HostConnectionHandle }).connection;
  const unregister = connection.fetch.register({
    path: brandPath,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => Response.json(brand, { headers: { 'cache-control': 'no-store' } }),
  });
  ctx.effect(() => unregister, 'workdsh.brand.fetch');
}
