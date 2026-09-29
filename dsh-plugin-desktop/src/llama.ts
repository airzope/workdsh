/**
 * The bundled llama.cpp server. It runs in router mode over the user's models
 * folder, listens only on loopback with a per-launch API key, and loads a
 * model on its first request. The WorkDSH Profile turns what it serves into
 * the local model route.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** Context size each model gets unless the user's presets set one. */
export const LLAMA_CONTEXT_SIZE = 32_768
/** Idle seconds before the router unloads a model and frees its memory. */
export const LLAMA_IDLE_SECONDS = 600
/** User presets file inside the models folder, in llama.cpp's router format. */
export const USER_PRESETS = 'presets.ini'

/** How to start the server. */
export interface LlamaServerPlan {
  readonly executable: string
  /** Working directory: the models folder, which model processes inherit. */
  readonly cwd: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly baseURL: string
  readonly apiKey: string
  readonly presets: string
}

/**
 * The staged server executable, from the manifest that staging wrote.
 * @param llamaDirectory - workdsh-runtime/llama.
 * @returns Its path, or undefined when this build has no server.
 */
export function llamaExecutable(llamaDirectory: string): string | undefined {
  const manifestPath = join(llamaDirectory, 'manifest.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { server?: unknown }
  if (typeof manifest.server !== 'string' || !/^bin\/llama-server(?:\.exe)?$/u.test(manifest.server)) return undefined
  // Absolute, because the server starts in the models folder.
  const executable = resolve(llamaDirectory, manifest.server)
  return existsSync(executable) ? executable : undefined
}

/** The note placed in a new models folder. */
export function modelsReadme(productName: string): string {
  return [
    `${productName} 本地模型文件夹`,
    '',
    '把 GGUF 模型文件（*.gguf）放在这里，几秒后即可在“模型”中选择“本地模型 (llama.cpp)”。',
    '一个文件对应一个模型，模型名为文件名；多模态模型或分卷模型可以各放在一个子文件夹中，模型名为子文件夹名。',
    'Windows 上的模型文件名和子文件夹名请只用英文字母、数字、“-”、“_”和“.”。',
    `模型在首次使用时加载，闲置 ${String(LLAMA_IDLE_SECONDS / 60)} 分钟后卸载。每个模型的默认上下文为 ${String(LLAMA_CONTEXT_SIZE)}，`,
    '且不超过模型的训练长度；可在本文件夹的 presets.ini 中按 llama.cpp 的路由预设格式调整。',
    '',
    `${productName} local models folder`,
    '',
    'Put GGUF model files (*.gguf) here; within seconds they appear under "本地模型 (llama.cpp)" in the model list.',
    'Each file is one model named after the file; put a multimodal or multi-part model in its own subfolder, named after the folder.',
    'On Windows, name model files and subfolders with English letters, digits, "-", "_" and "." only.',
    `A model loads on first use and unloads after ${String(LLAMA_IDLE_SECONDS / 60)} idle minutes. Each gets a ${String(LLAMA_CONTEXT_SIZE)}-token context,`,
    'capped at its trained length; override this in presets.ini here, using llama.cpp router presets.',
    '',
  ].join('\n')
}

/**
 * Create the models folder with its note.
 * @param directory - Models folder.
 * @param productName - White-label product name.
 */
export function ensureModelsDirectory(directory: string, productName: string): void {
  mkdirSync(directory, { recursive: true })
  const readme = join(directory, 'README.txt')
  if (!existsSync(readme)) writeFileSync(readme, modelsReadme(productName), 'utf8')
}

/**
 * Router presets used when the user has none: one default context size.
 * Router model processes do not read `LLAMA_ARG_*` variables, so a preset is
 * the way to set it.
 * @param contextSize - Context size.
 */
export function defaultPresets(contextSize: number): string {
  return `version = 1\n\n[*]\nc = ${String(contextSize)}\n`
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
  const fromCwd = relative(cwd, path) || '.'
  return !isAbsolute(fromCwd) && /^[\x20-\x7e]*$/u.test(fromCwd) ? fromCwd : path
}

/**
 * Plan the server launch.
 * @param options - Executable, folders, port, key and base environment.
 * @returns The plan; the default presets file is written when used.
 */
export function planLlamaServer(options: {
  readonly executable: string
  readonly modelsDirectory: string
  readonly stateDirectory: string
  readonly port: number
  readonly apiKey?: string
  readonly contextSize?: number
  readonly env: Readonly<Record<string, string | undefined>>
}): LlamaServerPlan {
  mkdirSync(options.stateDirectory, { recursive: true })
  const userPresets = join(options.modelsDirectory, USER_PRESETS)
  let presets = userPresets
  if (!existsSync(userPresets)) {
    presets = join(options.stateDirectory, 'presets.ini')
    writeFileSync(presets, defaultPresets(options.contextSize ?? LLAMA_CONTEXT_SIZE), 'utf8')
  }
  const apiKey = options.apiKey ?? randomBytes(24).toString('base64url')
  return {
    executable: options.executable,
    cwd: options.modelsDirectory,
    args: [
      '--host', '127.0.0.1',
      '--port', String(options.port),
      '--models-dir', '.',
      '--models-preset', serverPath(presets, options.modelsDirectory),
      '--models-max', '1',
      '--sleep-idle-seconds', String(LLAMA_IDLE_SECONDS),
      '--no-webui',
      '--offline',
    ],
    // Model processes inherit the key from the environment; --api-key would
    // protect only the router.
    env: { ...options.env, LLAMA_API_KEY: apiKey, LLAMA_CACHE: join(options.stateDirectory, 'cache') },
    baseURL: `http://127.0.0.1:${String(options.port)}/v1`,
    apiKey,
    presets,
  }
}

/**
 * Variables that tell the WorkDSH Profile where the server is.
 * @param plan - The running server's plan.
 * @param modelsDirectory - Models folder.
 * @param contextSize - Default context size.
 */
export function llamaRuntimeEnvironment(plan: LlamaServerPlan, modelsDirectory: string, contextSize = LLAMA_CONTEXT_SIZE): Record<string, string> {
  return {
    WORKDSH_LLAMA_BASE_URL: plan.baseURL,
    WORKDSH_LLAMA_API_KEY: plan.apiKey,
    WORKDSH_LLAMA_MODELS_DIR: modelsDirectory,
    WORKDSH_LLAMA_CONTEXT_SIZE: String(contextSize),
  }
}

/** A free loopback port. */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('No loopback port'))
        else resolve(address.port)
      })
    })
  })
}

/**
 * Start the server with its output in a log file.
 * @param plan - Launch plan.
 * @param logFile - Log destination, replaced on each launch.
 */
export function startLlamaServer(plan: LlamaServerPlan, logFile: string): ChildProcess {
  const log = openSync(logFile, 'w')
  return spawn(plan.executable, [...plan.args], {
    cwd: plan.cwd,
    env: plan.env,
    stdio: ['ignore', log, log],
    // Its own process group, so stopping it also stops the model processes.
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
}

/**
 * Wait until the server answers `/health`.
 * @param baseURL - Server base URL ending in `/v1`.
 * @param child - The server process; its exit ends the wait.
 * @param timeoutMs - Longest wait.
 * @returns Whether it became healthy.
 */
export async function waitForLlamaServer(baseURL: string, child: ChildProcess, timeoutMs = 15_000): Promise<boolean> {
  const health = `${baseURL.replace(/\/v1$/u, '')}/health`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // A failed spawn leaves no pid; an exited server has an exit code or signal.
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return false
    const status = await fetch(health, { signal: AbortSignal.timeout(2_000) }).then(response => response.status, () => 0)
    if (status === 200) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return false
}

/**
 * Stop the server and the model processes it started.
 * @param child - The server process.
 * @param platform - Host platform.
 */
export function stopLlamaServer(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}
