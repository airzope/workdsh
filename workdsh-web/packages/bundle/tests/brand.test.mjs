import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { brandPath, readProductBrand, registerBrand } from '../dist/brand.js';

test('reads the white-label name and mark the Desktop carrier passes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-brand-'));
  try {
    const svg = join(root, 'mark.svg');
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.deepEqual(readProductBrand({ WORKDSH_BRAND_NAME: ' 智办 ', WORKDSH_BRAND_MARK: svg }), {
      name: '智办', mark: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`,
    });
    assert.deepEqual(readProductBrand({}), { name: 'WorkDSH' });
    assert.deepEqual(readProductBrand({ WORKDSH_BRAND_NAME: 'bad\nname', WORKDSH_BRAND_MARK: join(root, 'missing.svg') }), { name: 'WorkDSH' });
    const script = join(root, 'mark.js');
    await writeFile(script, 'alert(1)');
    assert.deepEqual(readProductBrand({ WORKDSH_BRAND_MARK: script }), { name: 'WorkDSH' });
    const large = join(root, 'large.png');
    await writeFile(large, Buffer.alloc(300 * 1024));
    assert.deepEqual(readProductBrand({ WORKDSH_BRAND_MARK: large }), { name: 'WorkDSH' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('serves the brand on its Host route', async () => {
  let route;
  const effects = [];
  registerBrand({
    effect: (effect) => effects.push(effect),
    connection: { fetch: { register(value) { route = value; return async () => {}; } } },
  }, { name: 'Acme Desk' });
  assert.equal(route.path, brandPath);
  assert.deepEqual(route.methods, ['GET']);
  const response = await route.fetch(new Request(`http://localhost${brandPath}`));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { name: 'Acme Desk' });
  assert.equal(effects.length, 1);
});
