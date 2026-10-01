import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  apply,
  containsRoute,
  lastLogLine,
  localModelProfile,
  localRoute,
  presetContextSize,
  readGgufContextLength,
  routerModels,
  statusPath,
} from '../../packages/bundle/dist/local-models.js';
import {
  defaultPresets,
  freeLoopbackPort,
  hasGgufModels,
  planLlamaServer,
  readPreference,
  serverPath,
  waitForHealth,
  writePreference,
} from '../../packages/bundle/dist/llama-server.js';

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

/**
 * A Host for the plugin: settings with revisions, the Fetch route registry, a
 * default-model service and, when given, a subprocess service.
 */
function fakeHost({ subprocess } = {}) {
  const host = {
    user: { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } } },
    revision: 0,
    writes: [],
    logs: [],
    routes: [],
    selection: { provider: 'deepseek-official', model: 'deepseek-flash' },
    disposers: [],
  };
  host.ctx = {
    logger: { info: message => host.logs.push(message), warn: message => host.logs.push(message) },
    effect: (callback) => { const dispose = callback(); if (typeof dispose === 'function') host.disposers.push(dispose); },
    get: name => name === 'agentDefaultModel' ? {
      currentSelection: () => ({ ...host.selection }),
      saveSelection: async selection => { host.selection = { ...selection }; },
    } : undefined,
    connection: { fetch: { register: route => { host.routes.push(route); return async () => { host.routes.splice(host.routes.indexOf(route), 1); }; } } },
    subprocess,
    settings: {
      describe: () => [{ ns: 'llm-pi-ai', revision: host.revision, user: structuredClone(host.user) }],
      mutate: async (ns, ops, expected) => {
        assert.equal(ns, 'llm-pi-ai');
        assert.equal(expected, host.revision);
        host.writes.push(ops);
        for (const op of ops) {
          const providers = { ...host.user.providers };
          if (op.op === 'set') providers[op.path[1]] = structuredClone(op.value);
          else delete providers[op.path[1]];
          host.user = { ...host.user, providers };
        }
        host.revision++;
      },
    },
  };
  host.until = async (condition, attempts = 250) => {
    for (let attempt = 0; attempt < attempts && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(condition(), JSON.stringify({ writes: host.writes, logs: host.logs }));
  };
  host.call = async (method, body) => {
    const route = host.routes.find(item => item.path === statusPath);
    assert.ok(route, 'the status route is registered');
    const response = await route.fetch(new Request(`http://127.0.0.1${statusPath}`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    }));
    return { status: response.status, body: await response.json() };
  };
  host.dispose = () => { for (const dispose of host.disposers.splice(0)) dispose(); };
  return host;
}

/**
 * A subprocess service whose `llama-server` is a small HTTP server: it needs
 * the launch's key and lists the GGUF files in its working folder.
 */
function fakeLlama() {
  const fake = { spawns: [], live: 0 };
  fake.subprocess = {
    spawn(spec) {
      fake.spawns.push(spec);
      const port = Number(spec.argv[spec.argv.indexOf('--port') + 1]);
      let finish;
      const done = new Promise(resolve => { finish = resolve; });
      const server = createServer(async (request, response) => {
        if (request.url === '/health') { response.writeHead(200).end('{}'); return; }
        if (request.headers.authorization !== `Bearer ${spec.env.LLAMA_API_KEY}`) { response.writeHead(401).end(); return; }
        const files = (await readdir(spec.cwd)).filter(name => name.endsWith('.gguf'));
        response.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(listing(files.map(name => ({ id: name.slice(0, -5), path: `./${name}` })))));
      });
      server.listen(port, '127.0.0.1');
      fake.live++;
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        server.close(() => { fake.live--; finish({ exitCode: 0, signal: null }); });
      };
      return { stdout: undefined, stderr: undefined, done, terminate: stop, waitForExit: async () => { stop(); await done; return true; } };
    },
  };
  return fake;
}

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

test('serves the models folder on loopback with the key in the environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-llama-plan-'));
  try {
    const models = join(root, 'models');
    await mkdir(models);
    const launch = planLlamaServer({ server: '/app/llama/bin/llama-server', modelsDir: models, stateDir: join(root, 'state'), port: 18080, apiKey: 'k', contextSize: 32_768 });
    assert.equal(launch.cwd, models);
    assert.deepEqual(launch.argv, [
      '/app/llama/bin/llama-server', '--host', '127.0.0.1', '--port', '18080', '--models-dir', '.', '--models-preset', join('..', 'state', 'presets.ini'),
      '--models-max', '1', '--sleep-idle-seconds', '600', '--no-webui', '--offline',
    ]);
    assert.ok(!launch.argv.includes('k'), 'the key is never an argument');
    assert.deepEqual(launch.env, { LLAMA_API_KEY: 'k', LLAMA_CACHE: join(root, 'state', 'cache') });
    assert.equal(launch.baseURL, 'http://127.0.0.1:18080/v1');
    assert.equal(readFileSync(join(root, 'state', 'presets.ini'), 'utf8'), defaultPresets(32_768));

    // The user's presets replace the generated ones.
    await writeFile(join(models, 'presets.ini'), 'version = 1\n[*]\nc = 8192\n');
    const own = planLlamaServer({ server: 'llama-server', modelsDir: models, stateDir: join(root, 'other'), port: 1, apiKey: 'k', contextSize: 32_768 });
    assert.equal(own.argv[own.argv.indexOf('--models-preset') + 1], 'presets.ini');
    assert.equal(existsSync(join(root, 'other', 'presets.ini')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('passes llama.cpp ASCII paths relative to the models folder when it can', () => {
  const base = join(tmpdir(), '张三', 'WorkDSH');
  const models = join(base, 'models');
  assert.equal(serverPath(models, models), '.');
  assert.equal(serverPath(join(models, 'presets.ini'), models), 'presets.ini');
  assert.equal(serverPath(join(base, 'llama', 'presets.ini'), models), join('..', 'llama', 'presets.ini'));
  // A relative path that is not ASCII gains nothing, so the absolute path stays.
  const elsewhere = join(tmpdir(), '模型设置', 'presets.ini');
  assert.equal(serverPath(elsewhere, models), elsewhere);
});

test('finds GGUF models in the folder and its subfolders, and keeps the choice', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-llama-folder-'));
  try {
    assert.equal(hasGgufModels(join(root, 'missing')), false);
    await writeFile(join(root, 'README.txt'), 'note');
    assert.equal(hasGgufModels(root), false);
    await mkdir(join(root, 'vision'));
    await writeFile(join(root, 'vision', 'model.GGUF'), '');
    assert.equal(hasGgufModels(root), true);

    assert.deepEqual(readPreference(root), {});
    writePreference(root, { enabled: false, useAsDefault: true });
    assert.deepEqual(readPreference(root), { enabled: false, useAsDefault: true });
    await writeFile(join(root, 'local-models.json'), '{broken');
    assert.deepEqual(readPreference(root), {});
    assert.equal(lastLogLine('loading\nerror: model is corrupt\n\n'), 'error: model is corrupt');
    assert.equal(lastLogLine(''), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('waits for health and stops waiting when the server is gone', async () => {
  const server = createServer((request, response) => { response.writeHead(request.url === '/health' ? 200 : 404).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal(await waitForHealth(`http://127.0.0.1:${server.address().port}/v1`, () => true, 5_000), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  const started = Date.now();
  assert.equal(await waitForHealth(`http://127.0.0.1:${String(await freeLoopbackPort())}/v1`, () => false, 5_000), false);
  assert.ok(Date.now() - started < 1_000);
});

test('keeps the pi-ai route in step with an external router and needs its API key', async () => {
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
  const host = fakeHost();

  process.env.WORKDSH_TEST_LLAMA_KEY = key;
  try {
    apply(host.ctx, { baseURL, apiKeyEnv: 'WORKDSH_TEST_LLAMA_KEY', modelsDir: root, contextSize: 32_768, intervalMs: 50 });
    await host.until(() => host.writes.length === 1);
    const route = host.user.providers['llama-local'];
    assert.equal(route.api, 'openai-completions');
    assert.equal(route.baseURL, baseURL);
    assert.equal(route.apiKeyEnv, 'WORKDSH_TEST_LLAMA_KEY');
    assert.equal(JSON.stringify(route).includes(key), false, 'the key itself never reaches settings');
    assert.deepEqual(route.models.map(model => [model.id, model.contextWindow]), [['tiny', 2048]]);
    assert.deepEqual(host.user.providers.deepseek, { apiKeyEnv: 'DEEPSEEK_API_KEY' });
    assert.ok(requests.every(url => url === '/v1/models?reload=1'));

    // Unchanged listings do not rewrite settings.
    const polls = requests.length;
    await host.until(() => requests.length >= polls + 2);
    assert.equal(host.writes.length, 1);

    // A model added to the folder joins the route.
    served = [...served, { id: 'second', path: join(root, 'missing.gguf') }];
    await host.until(() => host.writes.length === 2);
    assert.deepEqual(host.user.providers['llama-local'].models.map(model => [model.id, model.contextWindow]), [['second', 32_768], ['tiny', 2048]]);

    // Someone else runs this router, so it cannot be stopped from here; it can be made the default.
    assert.deepEqual((await host.call('GET')).body, {
      mode: 'external', enabled: true, state: 'running', route: 'llama-local', models: ['second', 'tiny'], modelsDir: root, isDefault: false,
    });
    assert.equal((await host.call('POST', { enabled: false })).status, 409);
    assert.equal((await host.call('POST', { enabled: 'yes' })).status, 400);
    assert.equal((await host.call('POST', { useAsDefault: true })).body.isDefault, true);
    assert.deepEqual(host.selection, { provider: 'llama-local', model: 'second' });

    // An empty folder removes the route.
    served = [];
    await host.until(() => host.writes.length === 3);
    assert.equal(host.user.providers['llama-local'], undefined);
    assert.deepEqual(host.writes[2], [{ op: 'unset', path: ['providers', 'llama-local'] }]);
  } finally {
    host.dispose();
    delete process.env.WORKDSH_TEST_LLAMA_KEY;
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('starts the bundled server when the user chooses local models, and remembers it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-managed-llama-'));
  const modelsDir = join(root, '模型');
  const stateDir = join(root, 'llama');
  await mkdir(modelsDir);
  const fake = fakeLlama();
  const config = { server: '/app/llama-server', apiKeyEnv: 'WORKDSH_TEST_MANAGED_KEY', modelsDir, stateDir, contextSize: 32_768, intervalMs: 50 };
  process.env.WORKDSH_TEST_MANAGED_KEY = 'launch-key';
  let host = fakeHost({ subprocess: fake.subprocess });
  try {
    // Nothing is chosen and the folder is empty: the server stays off.
    apply(host.ctx, config);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(fake.spawns.length, 0);
    assert.deepEqual((await host.call('GET')).body, {
      mode: 'managed', enabled: null, state: 'stopped', route: 'llama-local', models: [], modelsDir, isDefault: false,
    });

    // Choosing local models starts it at once, even before there is a model.
    const started = await host.call('POST', { enabled: true, useAsDefault: true });
    assert.equal(started.status, 200);
    assert.equal(started.body.state, 'running');
    assert.deepEqual(started.body.models, []);
    assert.equal(fake.spawns.length, 1);
    assert.equal(fake.spawns[0].cwd, modelsDir);
    assert.equal(fake.spawns[0].argv[0], '/app/llama-server');
    assert.equal(fake.spawns[0].env.LLAMA_API_KEY, 'launch-key');
    assert.deepEqual(readPreference(stateDir), { enabled: true, useAsDefault: true });
    assert.equal(host.user.providers['llama-local'], undefined);

    // A model dropped into the folder joins the route and becomes the default once.
    await writeFile(join(modelsDir, 'tiny.gguf'), ggufHeader('llama', 4096));
    await host.until(() => host.user.providers['llama-local'] !== undefined);
    assert.equal(host.user.providers['llama-local'].apiKeyEnv, 'WORKDSH_TEST_MANAGED_KEY');
    assert.match(host.user.providers['llama-local'].baseURL, /^http:\/\/127\.0\.0\.1:\d+\/v1$/u);
    await host.until(() => host.selection.provider === 'llama-local');
    assert.deepEqual(host.selection, { provider: 'llama-local', model: 'tiny' });
    assert.deepEqual(readPreference(stateDir), { enabled: true });
    assert.equal((await host.call('GET')).body.isDefault, true);

    // Turning it off stops the server, removes the route and is remembered.
    const off = await host.call('POST', { enabled: false });
    assert.equal(off.body.state, 'stopped');
    assert.equal(off.body.enabled, false);
    assert.equal(fake.live, 0);
    assert.equal(host.user.providers['llama-local'], undefined);
    host.dispose();

    // The next launch honours the choice although the folder holds a model.
    host = fakeHost({ subprocess: fake.subprocess });
    apply(host.ctx, config);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(fake.spawns.length, 1);
    host.dispose();

    // Without a choice, a folder with a model starts the server by itself.
    await rm(join(stateDir, 'local-models.json'));
    host = fakeHost({ subprocess: fake.subprocess });
    apply(host.ctx, config);
    await host.until(() => host.user.providers['llama-local'] !== undefined);
    assert.equal(fake.spawns.length, 2);
    assert.equal(host.selection.provider, 'deepseek-official', 'starting by itself does not change the default');
    host.dispose();
    await host.until(() => fake.live === 0);
  } finally {
    host.dispose();
    delete process.env.WORKDSH_TEST_MANAGED_KEY;
    await rm(root, { recursive: true, force: true });
  }
});

test('reports a server that does not start, and retries when asked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-failing-llama-'));
  let attempts = 0;
  const subprocess = {
    spawn() {
      attempts++;
      const stderr = Readable.from([Buffer.from('main: error: unable to load the backend\n')]);
      return { stdout: undefined, stderr, done: new Promise(resolve => setTimeout(() => resolve({ exitCode: 1, signal: null }), 50)), terminate() {}, waitForExit: async () => true };
    },
  };
  process.env.WORKDSH_TEST_FAILING_KEY = 'k';
  const host = fakeHost({ subprocess });
  try {
    apply(host.ctx, { server: '/missing', apiKeyEnv: 'WORKDSH_TEST_FAILING_KEY', modelsDir: root, stateDir: join(root, '.state'), intervalMs: 50 });
    const failed = await host.call('POST', { enabled: true });
    assert.equal(failed.body.state, 'failed');
    assert.equal(failed.body.error, 'main: error: unable to load the backend');
    assert.equal(attempts, 1);
    // A failed server waits for the user instead of restarting in a loop.
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(attempts, 1);
    assert.equal((await host.call('POST', { enabled: true })).body.state, 'failed');
    assert.equal(attempts, 2);
    const log = join(root, '.state', 'server.log');
    await host.until(() => existsSync(log) && readFileSync(log, 'utf8').includes('unable to load the backend'));
  } finally {
    host.dispose();
    delete process.env.WORKDSH_TEST_FAILING_KEY;
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
