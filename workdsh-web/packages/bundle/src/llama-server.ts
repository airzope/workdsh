import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { isAbsolute, join, relative } from 'node:path';

/**
 * How the Profile runs a llama.cpp `llama-server` in router mode over a
 * models folder: on loopback, with the launch's API key, loading a model on
 * its first request.
 */

/** Idle seconds before the router unloads a model and frees its memory. */
export const LLAMA_IDLE_SECONDS = 600;
/** User presets file inside the models folder, in llama.cpp's router format. */
export const USER_PRESETS = 'presets.ini';
const PREFERENCE_FILE = 'local-models.json';

/** How to start the server. */
export interface LlamaLaunch {
  readonly argv: readonly string[];
  /** The models folder, which model processes inherit. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly baseURL: string;
}

/**
 * The user's choice, kept beside the server's other state.
 * `enabled` is unset until the user chooses: the server then runs while the
 * models folder holds a GGUF model.
 */
export interface LocalModelsPreference {
  enabled?: boolean;
  /** Make the first local model the default once one is served. */
  useAsDefault?: boolean;
}

/**
 * Router presets used when the user has none: one default context size.
 * Router model processes do not read `LLAMA_ARG_*` variables, so a preset is
 * the way to set it.
 * @param contextSize - Context size.
 */
export function defaultPresets(contextSize: number): string {
  return `version = 1\n\n[*]\nc = ${String(contextSize)}\n`;
}

/**
 * A path llama.cpp can open on every platform. On Windows it checks folder
 * and preset paths through the ANSI code page, so a non-ASCII path (a user
 * profile named in Chinese, say) is not found; the server therefore runs in
 * the models folder and gets paths relative to it when those are ASCII.
 * @param path - Absolute path.
 * @param cwd - The server's working directory.
 */
export function serverPath(path: string, cwd: string): string {
  const fromCwd = relative(cwd, path) || '.';
  return !isAbsolute(fromCwd) && /^[\x20-\x7e]*$/u.test(fromCwd) ? fromCwd : path;
}

/**
 * Plan the server launch; writes the default presets when the user has none.
 * @param options - Executable, folders, port, key and context size.
 */
export function planLlamaServer(options: {
  readonly server: string;
  readonly modelsDir: string;
  readonly stateDir: string;
  readonly port: number;
  readonly apiKey: string;
  readonly contextSize: number;
}): LlamaLaunch {
  mkdirSync(options.stateDir, { recursive: true });
  let presets = join(options.modelsDir, USER_PRESETS);
  if (!existsSync(presets)) {
    presets = join(options.stateDir, 'presets.ini');
    writeFileSync(presets, defaultPresets(options.contextSize), 'utf8');
  }
  return {
    argv: [
      options.server,
      '--host', '127.0.0.1',
      '--port', String(options.port),
      '--models-dir', '.',
      '--models-preset', serverPath(presets, options.modelsDir),
      '--models-max', '1',
      '--sleep-idle-seconds', String(LLAMA_IDLE_SECONDS),
      '--no-webui',
      '--offline',
    ],
    cwd: options.modelsDir,
    // Model processes inherit the key from the environment; --api-key would
    // protect only the router.
    env: { LLAMA_API_KEY: options.apiKey, LLAMA_CACHE: join(options.stateDir, 'cache') },
    baseURL: `http://127.0.0.1:${String(options.port)}/v1`,
  };
}

/** A free loopback port. */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('No loopback port'));
        else resolve(address.port);
      });
    });
  });
}

/**
 * Wait until the server answers `/health`.
 * @param baseURL - Server base URL ending in `/v1`.
 * @param alive - Whether the process is still running; its exit ends the wait.
 * @param timeoutMs - Longest wait.
 */
export async function waitForHealth(baseURL: string, alive: () => boolean, timeoutMs = 20_000): Promise<boolean> {
  const health = `${baseURL.replace(/\/v1$/u, '')}/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && alive()) {
    const status = await fetch(health, { signal: AbortSignal.timeout(2_000) }).then(response => response.status, () => 0);
    if (status === 200) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

const isGguf = (name: string): boolean => name.toLowerCase().endsWith('.gguf');

/**
 * Whether the folder holds a model the router would serve: a GGUF file in it,
 * or in one of its subfolders.
 * @param modelsDir - Models folder.
 */
export function hasGgufModels(modelsDir: string): boolean {
  let entries;
  try {
    entries = readdirSync(modelsDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && isGguf(entry.name)) return true;
    if (!entry.isDirectory()) continue;
    try {
      if (readdirSync(join(modelsDir, entry.name)).some(isGguf)) return true;
    } catch { /* an unreadable subfolder serves nothing */ }
  }
  return false;
}

/** The stored choice; empty when the user has not chosen or the file is unreadable. */
export function readPreference(stateDir: string): LocalModelsPreference {
  try {
    const value = JSON.parse(readFileSync(join(stateDir, PREFERENCE_FILE), 'utf8')) as Record<string, unknown>;
    return {
      ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
      ...(value.useAsDefault === true ? { useAsDefault: true } : {}),
    };
  } catch {
    return {};
  }
}

/** Store the choice, replacing the file in one step. */
export function writePreference(stateDir: string, preference: LocalModelsPreference): void {
  mkdirSync(stateDir, { recursive: true });
  const target = join(stateDir, PREFERENCE_FILE);
  writeFileSync(`${target}.tmp`, `${JSON.stringify(preference, null, 2)}\n`, 'utf8');
  renameSync(`${target}.tmp`, target);
}
