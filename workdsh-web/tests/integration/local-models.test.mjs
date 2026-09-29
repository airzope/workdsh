import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  apply,
  containsRoute,
  localModelProfile,
  localRoute,
  presetContextSize,
  readGgufContextLength,
  routerModels,
} from '../../packages/bundle/dist/local-models.js';

/** A GGUF header with a tokenizer array before the context length, and no tensors. */
function ggufHeader(architecture, contextLength) {
  const parts = [];
  const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); parts.push(b); };
  const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); parts.push(b); };
  const string = value => { const bytes = Buffer.from(value); u64(bytes.length); parts.push(bytes); };
  parts.push(Buffer.from('GGUF'));
  u32(3);
  u64(0);
  u64(contextLength === undefined ? 3 : 4);
  string('general.architecture'); u32(8); string(architecture);
  string('tokenizer.ggml.tokens'); u32(9); u32(8); u64(3); string('<unk>'); string('<s>'); string('</s>');
  string('tokenizer.ggml.scores'); u32(9); u32(6); u64(3); parts.push(Buffer.alloc(12));
  if (contextLength !== undefined) { string(`${architecture}.context_length`); u32(4); u32(contextLength); }
  return Buffer.concat(parts);
}

const listing = models => ({
  object: 'list',
  data: models.map(({ id, path, preset = '', image = false }) => ({
    id,
    object: 'model',
    status: { value: 'unloaded', args: ['llama-server', '--host', '127.0.0.1', '--alias', id, '--model', path], preset: `[${id}]\n${preset}model = ${path}\n` },
    architecture: { input_modalities: image ? ['text', 'image'] : ['text'], output_modalities: ['text'] },
    source: 'models_dir',
  })),
});

test('reads the trained context length after skipping tokenizer arrays', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-gguf-'));
  try {
    await writeFile(join(root, 'qwen.gguf'), ggufHeader('qwen3', 40_960));
    await writeFile(join(root, 'plain.gguf'), ggufHeader('llama'));
    await writeFile(join(root, 'text.gguf'), 'not a model');
    assert.equal(await readGgufContextLength(join(root, 'qwen.gguf')), 40_960);
    assert.equal(await readGgufContextLength(join(root, 'plain.gguf')), undefined);
    assert.equal(await readGgufContextLength(join(root, 'text.gguf')), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('turns the router listing into model entries sized to what the router serves', () => {
  const models = routerModels(listing([
    { id: 'qwen3-8b', path: '/m/qwen3-8b.gguf' },
    { id: 'gemma-vision', path: '/m/gemma/gemma.gguf', preset: 'c = 8192\n', image: true },
  ]));
  assert.deepEqual(models.map(model => model.id), ['gemma-vision', 'qwen3-8b']);
  assert.deepEqual(models[0], { id: 'gemma-vision', path: '/m/gemma/gemma.gguf', presetContext: 8192, input: ['text', 'image'] });
  assert.deepEqual(localModelProfile(models[1], 40_960, 32_768), {
    id: 'qwen3-8b', name: 'qwen3-8b', contextWindow: 32_768, maxTokens: 8192, input: ['text'], reasoningEfforts: false,
  });
  assert.equal(localModelProfile(models[1], 4096, 32_768).contextWindow, 4096);
  assert.equal(localModelProfile(models[0], 131_072, 32_768).contextWindow, 8192);
  assert.equal(localModelProfile(models[0], 131_072, 32_768).maxTokens, 2048);
  assert.equal(presetContextSize('ctx-size = 16384'), 16_384);
  assert.equal(presetContextSize('model = /m/x.gguf'), undefined);
  const relative = routerModels(listing([{ id: 'served-here', path: './served-here.gguf' }]), '/data/模型');
  assert.equal(relative[0].path, join('/data/模型', 'served-here.gguf'));
  assert.equal(routerModels(listing([{ id: 'x', path: './x.gguf' }]))[0].path, './x.gguf');
  assert.deepEqual(routerModels({ data: [{ id: '' }, {}, 'x'] }), []);
  assert.deepEqual(routerModels(undefined), []);
});

test('compares only the fields the route sets', () => {
  const route = localRoute([{ id: 'a', name: 'a', contextWindow: 4096, maxTokens: 1024, input: ['text'], reasoningEfforts: false }], {
    baseURL: 'http://127.0.0.1:1/v1', apiKeyEnv: 'WORKDSH_LLAMA_API_KEY', displayName: 'Local',
  });
  const stored = structuredClone(route);
  stored.streamIdleTimeoutMs = 300_000;
  stored.models[0].compat = {};
  assert.equal(containsRoute(stored, route), true);
  stored.models[0].contextWindow = 8192;
  assert.equal(containsRoute(stored, route), false);
  assert.equal(containsRoute(undefined, route), false);
});

test('keeps the pi-ai route in step with the router and needs its API key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-local-models-'));
  const key = 'secret-key';
  // The router serves the models folder as '.', so it lists relative paths.
  let served = [{ id: 'tiny', path: './tiny.gguf' }];
  await writeFile(join(root, 'tiny.gguf'), ggufHeader('llama', 2048));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.headers.authorization !== `Bearer ${key}`) {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(listing(served)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;

  let user = { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } } };
  let revision = 0;
  const writes = [];
  const logs = [];
  let dispose;
  const ctx = {
    logger: { info: message => logs.push(message), warn: message => logs.push(message) },
    effect: (callback) => { dispose = callback(); },
    settings: {
      describe: () => [{ ns: 'llm-pi-ai', revision, user: structuredClone(user) }],
      mutate: async (ns, ops, expected) => {
        assert.equal(ns, 'llm-pi-ai');
        assert.equal(expected, revision);
        writes.push(ops);
        for (const op of ops) {
          const providers = { ...user.providers };
          if (op.op === 'set') providers[op.path[1]] = structuredClone(op.value);
          else delete providers[op.path[1]];
          user = { ...user, providers };
        }
        revision++;
      },
    },
  };
  const until = async (condition) => {
    for (let attempt = 0; attempt < 100 && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(condition(), JSON.stringify({ writes, logs }));
  };

  process.env.WORKDSH_TEST_LLAMA_KEY = key;
  try {
    apply(ctx, { baseURL, apiKeyEnv: 'WORKDSH_TEST_LLAMA_KEY', modelsDir: root, contextSize: 32_768, intervalMs: 50 });
    await until(() => writes.length === 1);
    const route = user.providers['llama-local'];
    assert.equal(route.api, 'openai-completions');
    assert.equal(route.baseURL, baseURL);
    assert.equal(route.apiKeyEnv, 'WORKDSH_TEST_LLAMA_KEY');
    assert.equal(JSON.stringify(route).includes(key), false, 'the key itself never reaches settings');
    assert.deepEqual(route.models.map(model => [model.id, model.contextWindow]), [['tiny', 2048]]);
    assert.deepEqual(user.providers.deepseek, { apiKeyEnv: 'DEEPSEEK_API_KEY' });
    assert.ok(requests.every(url => url === '/v1/models?reload=1'));

    // Unchanged listings do not rewrite settings.
    const polls = requests.length;
    await until(() => requests.length >= polls + 2);
    assert.equal(writes.length, 1);

    // A model added to the folder joins the route.
    served = [...served, { id: 'second', path: join(root, 'missing.gguf') }];
    await until(() => writes.length === 2);
    assert.deepEqual(user.providers['llama-local'].models.map(model => [model.id, model.contextWindow]), [['second', 32_768], ['tiny', 2048]]);

    // An empty folder removes the route.
    served = [];
    await until(() => writes.length === 3);
    assert.equal(user.providers['llama-local'], undefined);
    assert.deepEqual(writes[2], [{ op: 'unset', path: ['providers', 'llama-local'] }]);
  } finally {
    dispose?.();
    delete process.env.WORKDSH_TEST_LLAMA_KEY;
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('stays idle without a local model server', () => {
  const logs = [];
  let effects = 0;
  apply({ logger: { info: message => logs.push(message) }, effect: () => { effects++; } }, {});
  assert.equal(effects, 0);
  assert.match(logs[0], /no local model server/u);
});
