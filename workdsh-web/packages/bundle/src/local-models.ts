import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent-default-model';
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-settings';
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess';
import { createWriteStream, watch, type FSWatcher } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
  freeLoopbackPort, hasGgufModels, planLlamaServer, readPreference, waitForHealth, writePreference,
  type LocalModelsPreference,
} from './llama-server.js';
import { statusPath, type LocalModelsRequest, type LocalModelsStatus, type ServerState } from './local-models-contract.js';

/**
 * Keep one `llm-pi-ai` provider route in step with a llama.cpp router server:
 * every GGUF model it serves from its models folder becomes a selectable
 * model. Desktop passes the bundled `llama-server`, which this plugin starts
 * when the user chooses local models, or by itself once the models folder
 * holds one. A Web deployment can instead point `baseURL` at its own router.
 */
export const name = 'workdsh-local-models';
export const inject = ['settings', 'connection', 'subprocess'];

export { statusPath, type LocalModelsRequest, type LocalModelsStatus, type ServerState } from './local-models-contract.js';

export interface Config {
  /** OpenAI-compatible base URL of a router someone else runs, ending in `/v1`. */
  baseURL?: string;
  /** A `llama-server` executable to run when no `baseURL` is given. */
  server?: string;
  /** Environment variable holding the router's API key, set when the Host starts. */
  apiKeyEnv?: string;
  /** Folder the router serves; watched so new files appear promptly. */
  modelsDir?: string;
  /** Where a started server keeps its presets, cache, log and the user's choice. */
  stateDir?: string;
  /** Context size the router gives each model unless a preset sets one. */
  contextSize?: number;
  /** Profile entry of the pi-ai adapter whose settings hold the route. */
  settingsEntry?: string;
  /** Provider route key. */
  route?: string;
  /** Route name shown on the Models page. */
  displayName?: string;
  /** Fallback rescan interval. */
  intervalMs?: number;
}

/** One model the router lists. */
export interface RouterModel {
  readonly id: string;
  /** GGUF file the router loads it from, when it says. */
  readonly path?: string;
  /** Context size its preset sets, when one does. */
  readonly presetContext?: number;
  readonly input: readonly ('text' | 'image')[];
}

/** A model entry of the provider route. */
export interface LocalModelProfile {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  input: ('text' | 'image')[];
  reasoningEfforts: false;
}

export const DEFAULT_CONTEXT_SIZE = 32_768;
const GGUF_TYPE_SIZES: Readonly<Record<number, number>> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const GGUF_STRING = 8;
const GGUF_ARRAY = 9;
const GGUF_SCAN_LIMIT = 64 * 1024 * 1024;

type SettingsOp = Parameters<Context['settings']['mutate']>[1][number];

/**
 * Read the trained context length (`<architecture>.context_length`) from a GGUF header.
 * @param path - GGUF file.
 * @returns The length, or undefined when the file does not declare one.
 */
export async function readGgufContextLength(path: string): Promise<number | undefined> {
  const handle = await open(path, 'r');
  try {
    let window = Buffer.alloc(0);
    let start = 0;
    let offset = 0;
    const ensure = async (length: number): Promise<void> => {
      if (offset + length > GGUF_SCAN_LIMIT) throw new Error('GGUF header is too large');
      if (offset + length <= start + window.length) return;
      const size = Math.max(length, 1 << 20);
      const chunk = Buffer.alloc(size);
      const { bytesRead } = await handle.read(chunk, 0, size, offset);
      if (bytesRead < length) throw new Error('GGUF header is truncated');
      window = chunk.subarray(0, bytesRead);
      start = offset;
    };
    const u32 = async (): Promise<number> => { await ensure(4); const value = window.readUInt32LE(offset - start); offset += 4; return value; };
    const u64 = async (): Promise<number> => { await ensure(8); const value = Number(window.readBigUInt64LE(offset - start)); offset += 8; return value; };
    const string = async (): Promise<string> => {
      const length = await u64();
      await ensure(length);
      const value = window.toString('utf8', offset - start, offset - start + length);
      offset += length;
      return value;
    };
    const skip = async (type: number): Promise<void> => {
      if (type === GGUF_STRING) {
        // Read the length first: `offset += await u64()` would add it to the pre-read offset.
        const length = await u64();
        offset += length;
        return;
      }
      if (type === GGUF_ARRAY) {
        const itemType = await u32();
        const count = await u64();
        const size = GGUF_TYPE_SIZES[itemType];
        if (size !== undefined) offset += size * count;
        else for (let index = 0; index < count; index++) await skip(itemType);
        return;
      }
      const size = GGUF_TYPE_SIZES[type];
      if (size === undefined) throw new Error(`Unknown GGUF value type ${String(type)}`);
      offset += size;
    };
    const integer = async (type: number): Promise<number | undefined> => {
      if (type === 4) return u32();
      if (type === 10) return u64();
      if (type === 5) { await ensure(4); const value = window.readInt32LE(offset - start); offset += 4; return value; }
      await skip(type);
      return undefined;
    };

    const head = Buffer.alloc(24);
    const { bytesRead } = await handle.read(head, 0, 24, 0);
    if (bytesRead < 24 || head.toString('latin1', 0, 4) !== 'GGUF') return undefined;
    offset = 8;
    await u64();
    const count = await u64();
    let architecture: string | undefined;
    const lengths = new Map<string, number>();
    for (let index = 0; index < count; index++) {
      const key = await string();
      const type = await u32();
      if (key === 'general.architecture' && type === GGUF_STRING) architecture = await string();
      else if (key.endsWith('.context_length')) {
        const value = await integer(type);
        if (value !== undefined) lengths.set(key.slice(0, -'.context_length'.length), value);
      } else await skip(type);
      if (architecture !== undefined && lengths.has(architecture)) return lengths.get(architecture);
    }
    return architecture === undefined ? undefined : lengths.get(architecture);
  } finally {
    await handle.close();
  }
}

/**
 * The context size a router preset sets (`c` or `ctx-size`).
 * @param preset - Preset text the router reports for a model.
 */
export function presetContextSize(preset: string | undefined): number | undefined {
  const match = preset === undefined ? null : /^\s*(?:c|ctx-size|ctx_size)\s*=\s*(\d+)\s*$/mu.exec(preset);
  const value = match === null ? 0 : Number(match[1]);
  return value > 0 ? value : undefined;
}

/**
 * Read a router's `/v1/models` listing.
 * @param listing - Response body.
 * @param modelsDir - The router's working folder: Desktop serves the models
 *   folder as `.`, so model paths in the listing are relative to it.
 * @returns Models sorted by id.
 */
export function routerModels(listing: unknown, modelsDir?: string): RouterModel[] {
  const data = (listing as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(data)) return [];
  const models: RouterModel[] = [];
  for (const item of data as Record<string, unknown>[]) {
    if (typeof item?.id !== 'string' || item.id.length === 0) continue;
    const status = item.status as { args?: unknown, preset?: unknown } | undefined;
    const args = Array.isArray(status?.args) ? status.args.filter((arg): arg is string => typeof arg === 'string') : [];
    const modelFlag = args.findIndex(arg => arg === '--model' || arg === '-m');
    const modalities = (item.architecture as { input_modalities?: unknown } | undefined)?.input_modalities;
    const presetContext = presetContextSize(typeof status?.preset === 'string' ? status.preset : undefined);
    const listed = modelFlag >= 0 ? args[modelFlag + 1] : undefined;
    const path = listed !== undefined && !isAbsolute(listed) && modelsDir ? resolve(modelsDir, listed) : listed;
    models.push({
      id: item.id,
      ...(path !== undefined ? { path } : {}),
      ...(presetContext === undefined ? {} : { presetContext }),
      input: Array.isArray(modalities) && modalities.includes('image') ? ['text', 'image'] : ['text'],
    });
  }
  return models.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * The model entry for one router model.
 * @param model - Router model.
 * @param trained - Trained context length from its GGUF file.
 * @param contextSize - Router default context size.
 */
export function localModelProfile(model: RouterModel, trained: number | undefined, contextSize: number): LocalModelProfile {
  const served = model.presetContext ?? contextSize;
  const contextWindow = trained !== undefined && trained > 0 ? Math.min(trained, served) : served;
  return {
    id: model.id,
    name: model.id,
    contextWindow,
    maxTokens: Math.max(256, Math.min(8_192, Math.floor(contextWindow / 4))),
    input: [...model.input],
    reasoningEfforts: false,
  };
}

/**
 * The provider route for a set of local models.
 * @param models - Model entries.
 * @param options - Route facts.
 */
export function localRoute(models: readonly LocalModelProfile[], options: { baseURL: string, apiKeyEnv: string, displayName: string }): Record<string, unknown> {
  return {
    displayName: options.displayName,
    api: 'openai-completions',
    baseURL: options.baseURL,
    apiKeyEnv: options.apiKeyEnv,
    // llama.cpp's OpenAI-compatible server has no stored responses, developer
    // role, reasoning-effort parameter or strict tool schemas.
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
      maxTokensField: 'max_tokens',
    },
    models: models.map(model => ({ ...model, input: [...model.input] })),
  };
}

/**
 * Whether every field of `expected` is present and equal in `actual`.
 * Stored settings may carry schema defaults the route does not set.
 */
export function containsRoute(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => containsRoute(actual[index], item));
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => containsRoute((actual as Record<string, unknown>)[key], value));
  }
  return actual === expected;
}

/**
 * The last meaningful line of a server log, for the status.
 * @param log - Recent output.
 */
export function lastLogLine(log: string): string | undefined {
  const line = log.split(/\r?\n/u).map(item => item.trim()).filter(Boolean).at(-1);
  return line === undefined ? undefined : line.slice(0, 300);
}

export function apply(ctx: Context, config: Config = {}): void {
  const external = config.baseURL?.trim().replace(/\/+$/u, '') || undefined;
  const managed = external === undefined && config.server && config.modelsDir && config.stateDir
    ? { server: config.server, modelsDir: config.modelsDir, stateDir: config.stateDir }
    : undefined;
  if (external === undefined && managed === undefined) {
    ctx.logger.info('workdsh-local-models: no local model server configured');
    return;
  }
  const apiKeyEnv = config.apiKeyEnv ?? 'WORKDSH_LLAMA_API_KEY';
  const settingsEntry = config.settingsEntry ?? 'llm-pi-ai';
  const route = config.route ?? 'llama-local';
  const displayName = config.displayName ?? '本地模型 (llama.cpp)';
  const contextSize = config.contextSize !== undefined && config.contextSize > 0 ? config.contextSize : DEFAULT_CONTEXT_SIZE;
  const modelsDir = managed?.modelsDir ?? config.modelsDir;
  const trainedLengths = new Map<string, number | undefined>();
  let preference: LocalModelsPreference = managed ? readPreference(managed.stateDir) : {};
  let state: ServerState = external === undefined ? 'stopped' : 'running';
  let baseURL = external;
  let error: string | undefined;
  let served: string[] = [];
  let server: SubprocessHandle | undefined;
  let stopped = false;
  let running: Promise<void> | undefined;
  let queued: Promise<void> | undefined;
  let synced = false;

  const trainedLength = async (path: string | undefined): Promise<number | undefined> => {
    if (path === undefined) return undefined;
    if (!trainedLengths.has(path)) {
      trainedLengths.set(path, await readGgufContextLength(path).catch((cause: unknown) => {
        ctx.logger.warn(`workdsh-local-models: cannot read ${path}: ${String(cause)}`);
        return undefined;
      }));
    }
    return trainedLengths.get(path);
  };

  const remember = (next: LocalModelsPreference): void => {
    preference = next;
    if (!managed) return;
    try {
      writePreference(managed.stateDir, next);
    } catch (cause) {
      ctx.logger.warn(`workdsh-local-models: cannot store the choice: ${String(cause)}`);
    }
  };

  const defaults = () => ctx.get('agentDefaultModel');

  // The user asked for a local default: take the first model once one is
  // served, unless the default already is one of them.
  const applyDefault = async (models: readonly LocalModelProfile[]): Promise<void> => {
    const service = defaults();
    if (!preference.useAsDefault || models.length === 0 || service === undefined) return;
    const current = service.currentSelection();
    if (current.provider !== route || !models.some(model => model.id === current.model)) {
      await service.saveSelection({ provider: route, model: models[0].id });
      ctx.logger.info(`workdsh-local-models: new agents now start on ${models[0].id}`);
    }
    const { useAsDefault: _done, ...rest } = preference;
    remember(rest);
  };

  const syncOnce = async (): Promise<void> => {
    const target = state === 'running' ? baseURL : undefined;
    // The route appears once the server answers.
    if (state === 'starting') return;
    let profiles: LocalModelProfile[] = [];
    if (target !== undefined) {
      const key = process.env[apiKeyEnv];
      const response = await fetch(`${target}/models?reload=1`, {
        headers: key ? { authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${target}/models returned ${String(response.status)}`);
      const models = routerModels(await response.json(), modelsDir);
      for (const model of models) profiles.push(localModelProfile(model, await trainedLength(model.path), contextSize));
    }
    if (stopped) return;
    const descriptor = ctx.settings.describe().find(item => item.ns === settingsEntry);
    if (descriptor === undefined) throw new Error(`settings entry ${settingsEntry} is not active yet`);
    const current = (descriptor.user as { providers?: Record<string, unknown> } | undefined)?.providers?.[route];
    served = profiles.map(model => model.id);
    if (target === undefined || profiles.length === 0) {
      if (current !== undefined) {
        await ctx.settings.mutate(settingsEntry, [{ op: 'unset', path: ['providers', route] }], descriptor.revision);
        ctx.logger.info(target === undefined ? 'workdsh-local-models: the server is not running; removed the local route' : 'workdsh-local-models: no GGUF models; removed the local route');
      }
      synced = true;
      return;
    }
    const desired = localRoute(profiles, { baseURL: target, apiKeyEnv, displayName });
    if (!containsRoute(current, desired) || !containsRoute(desired, current)) {
      await ctx.settings.mutate(settingsEntry, [{ op: 'set', path: ['providers', route], value: desired } as SettingsOp], descriptor.revision);
      ctx.logger.info(`workdsh-local-models: serving ${profiles.map(model => model.id).join(', ')}`);
    }
    synced = true;
    await applyDefault(profiles);
  };

  // A sync asked for while one runs waits for a fresh one, so the answer
  // reflects every change made before the call.
  const sync = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running !== undefined) {
      queued ??= running.then(() => { queued = undefined; return sync(); });
      return queued;
    }
    running = syncOnce()
      .catch((cause: unknown) => { if (!stopped) ctx.logger.warn(`workdsh-local-models: ${String(cause instanceof Error ? cause.message : cause)}`); })
      .finally(() => { running = undefined; });
    return running;
  };

  const startServer = async (): Promise<void> => {
    if (!managed || stopped || server !== undefined) return;
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      state = 'failed';
      error = `${apiKeyEnv} is not set`;
      return;
    }
    state = 'starting';
    error = undefined;
    let launch;
    try {
      launch = planLlamaServer({ ...managed, port: await freeLoopbackPort(), apiKey, contextSize });
    } catch (cause) {
      state = 'failed';
      error = String(cause instanceof Error ? cause.message : cause);
      return;
    }
    const log = createWriteStream(join(managed.stateDir, 'server.log'));
    log.on('error', () => { /* the log is a convenience */ });
    let recent = '';
    let exited = false;
    let started: SubprocessHandle;
    try {
      started = ctx.subprocess.spawn({
        argv: launch.argv,
        cwd: launch.cwd,
        env: launch.env,
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: 5_000,
      });
    } catch (cause) {
      log.end();
      state = 'failed';
      error = String(cause instanceof Error ? cause.message : cause);
      return;
    }
    server = started;
    for (const stream of [started.stdout, started.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        log.write(chunk);
        recent = `${recent}${chunk.toString('utf8')}`.slice(-8_192);
      });
    }
    void started.done
      .then(outcome => `llama-server exited (${String(outcome.exitCode ?? outcome.signal)})`, (cause: unknown) => String(cause))
      .then(reason => {
        exited = true;
        log.end();
        // A stop clears `server` first; anything else is a failure.
        if (server !== started || stopped) return;
        server = undefined;
        baseURL = undefined;
        state = 'failed';
        error = lastLogLine(recent) ?? reason;
        ctx.logger.warn(`workdsh-local-models: ${reason}; see ${join(managed.stateDir, 'server.log')}`);
        void sync();
      });
    if (!(await waitForHealth(launch.baseURL, () => !exited && server === started))) {
      if (server !== started) return;
      server = undefined;
      started.terminate();
      state = 'failed';
      error = lastLogLine(recent) ?? 'llama-server did not start';
      ctx.logger.warn(`workdsh-local-models: llama-server did not start; see ${join(managed.stateDir, 'server.log')}`);
      return;
    }
    if (server !== started) return;
    baseURL = launch.baseURL;
    state = 'running';
    ctx.logger.info(`workdsh-local-models: llama-server is serving ${managed.modelsDir}`);
  };

  const stopServer = async (): Promise<void> => {
    const current = server;
    server = undefined;
    baseURL = undefined;
    state = 'stopped';
    error = undefined;
    if (current === undefined) return;
    current.terminate();
    await current.waitForExit().catch(() => false);
  };

  // One start or stop at a time, in request order.
  let transition: Promise<void> = Promise.resolve();
  const reconcile = (): Promise<void> => {
    transition = transition.then(async () => {
      if (!managed || stopped) return;
      const wanted = preference.enabled ?? hasGgufModels(managed.modelsDir);
      // A failed server waits for the user to ask again.
      if (wanted && server === undefined && state !== 'failed') await startServer();
      else if (!wanted && (server !== undefined || state === 'failed')) await stopServer();
    }).catch((cause: unknown) => { ctx.logger.warn(`workdsh-local-models: ${String(cause)}`); });
    return transition.then(sync);
  };

  const status = (): LocalModelsStatus => ({
    mode: managed ? 'managed' : 'external',
    enabled: managed ? preference.enabled ?? null : true,
    state,
    route,
    models: [...served],
    ...(modelsDir ? { modelsDir } : {}),
    isDefault: defaults()?.currentSelection().provider === route,
    ...(error ? { error } : {}),
  });

  const respond = async (request: Request): Promise<Response> => {
    if (request.method === 'GET' || request.method === 'HEAD') return Response.json(status(), { headers: { 'cache-control': 'no-store' } });
    const body = await request.json().catch(() => undefined) as LocalModelsRequest | undefined;
    if (body === undefined || body === null || typeof body !== 'object'
      || (body.enabled !== undefined && typeof body.enabled !== 'boolean')
      || (body.useAsDefault !== undefined && typeof body.useAsDefault !== 'boolean')) {
      return Response.json({ error: 'Expected { enabled?: boolean, useAsDefault?: boolean }' }, { status: 400 });
    }
    if (body.enabled !== undefined && !managed) {
      return Response.json({ error: 'This local model server is managed outside WorkDSH' }, { status: 409 });
    }
    let next = { ...preference };
    if (body.enabled !== undefined) {
      next.enabled = body.enabled;
      // Asking again retries a server that failed.
      if (body.enabled && state === 'failed') state = 'stopped';
    }
    if (body.useAsDefault === true && next.enabled !== false) next.useAsDefault = true;
    if (body.useAsDefault === false || next.enabled === false) {
      const { useAsDefault: _dropped, ...rest } = next;
      next = rest;
    }
    remember(next);
    await reconcile();
    return Response.json(status(), { headers: { 'cache-control': 'no-store' } });
  };

  const connection = (ctx as Context & { connection: HostConnectionHandle }).connection;
  const unregister = connection.fetch.register({ path: statusPath, methods: ['GET', 'HEAD', 'POST'], requestBody: 'buffered', fetch: respond });
  ctx.effect(() => unregister, 'workdsh.local-models.fetch');

  ctx.effect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let watcher: FSWatcher | undefined;
    if (modelsDir) {
      try {
        watcher = watch(modelsDir, () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => { void reconcile(); }, 1_500);
        });
        watcher.on('error', () => watcher?.close());
      } catch (cause) {
        ctx.logger.warn(`workdsh-local-models: cannot watch ${modelsDir}: ${String(cause)}`);
      }
    }
    // Poll quickly until the first sync lands (the server and the adapter
    // entry may still be starting), then slowly as a watcher fallback. Each
    // delay is chosen once the previous sync has finished.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => {
      void reconcile().then(() => {
        if (!stopped) timer = setTimeout(tick, synced ? config.intervalMs ?? 30_000 : 2_000);
      });
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(debounce);
      watcher?.close();
      server?.terminate();
      server = undefined;
    };
  }, 'workdsh.local-models.sync');
}
