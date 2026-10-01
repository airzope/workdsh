/**
 * The bundled llama.cpp server. The carrier finds it and prepares the user's
 * models folder; the WorkDSH Profile (`workdsh-bundle/local-models`) runs it
 * in router mode on loopback, with the per-launch key passed here, and turns
 * what it serves into the local model route.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Context size each model gets unless the user's presets set one. */
export const LLAMA_CONTEXT_SIZE = 32_768
/** Idle seconds before the router unloads a model and frees its memory. */
export const LLAMA_IDLE_SECONDS = 600

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
    '把 GGUF 模型文件（*.gguf）放在这里，本地模型服务会自动启动，几秒后即可在模型列表中选择“本地模型 (llama.cpp)”。',
    '如果在“设置 → 模型”中关闭了本地模型服务，请先把它打开。',
    '一个文件对应一个模型，模型名为文件名；多模态模型或分卷模型可以各放在一个子文件夹中，模型名为子文件夹名。',
    'Windows 上的模型文件名和子文件夹名请只用英文字母、数字、“-”、“_”和“.”。',
    `模型在首次使用时加载，闲置 ${String(LLAMA_IDLE_SECONDS / 60)} 分钟后卸载。每个模型的默认上下文为 ${String(LLAMA_CONTEXT_SIZE)}，`,
    '且不超过模型的训练长度；可在本文件夹的 presets.ini 中按 llama.cpp 的路由预设格式调整。',
    '',
    `${productName} local models folder`,
    '',
    'Put GGUF model files (*.gguf) here; the local model server starts by itself, and within seconds they appear under "本地模型 (llama.cpp)" in the model list.',
    'If you turned the local model server off under Settings > Models, turn it back on.',
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
 * Variables that tell the WorkDSH Profile how to run the server. The Profile
 * starts it when the user chooses local models, or once the folder holds one.
 * The key is generated per launch and must be in DSH's environment from the
 * start, because DSH reads credentials from its launch environment.
 * @param options - Server, folders, key and context size.
 */
export function localModelsEnvironment(options: {
  readonly executable: string
  readonly modelsDirectory: string
  readonly stateDirectory: string
  readonly apiKey?: string
  readonly contextSize?: number
}): Record<string, string> {
  return {
    WORKDSH_LLAMA_SERVER: options.executable,
    WORKDSH_LLAMA_API_KEY: options.apiKey ?? randomBytes(24).toString('base64url'),
    WORKDSH_LLAMA_MODELS_DIR: options.modelsDirectory,
    WORKDSH_LLAMA_STATE_DIR: options.stateDirectory,
    WORKDSH_LLAMA_CONTEXT_SIZE: String(options.contextSize ?? LLAMA_CONTEXT_SIZE),
  }
}
