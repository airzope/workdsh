import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LLAMA_CONTEXT_SIZE,
  ensureModelsDirectory,
  llamaExecutable,
  localModelsEnvironment,
  modelsReadme,
} from '../src/llama.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-carrier-llama-'))
  roots.push(root)
  return root
}

describe('local model server', () => {
  it('finds the staged server only through its manifest', () => {
    const llama = temporary()
    expect(llamaExecutable(llama)).toBeUndefined()
    writeFileSync(join(llama, 'manifest.json'), JSON.stringify({ server: 'bin/llama-server' }))
    expect(llamaExecutable(llama)).toBeUndefined()
    mkdirSync(join(llama, 'bin'))
    writeFileSync(join(llama, 'bin', 'llama-server'), '')
    expect(llamaExecutable(llama)).toBe(join(llama, 'bin', 'llama-server'))
    writeFileSync(join(llama, 'manifest.json'), JSON.stringify({ server: '../../elsewhere' }))
    expect(llamaExecutable(llama)).toBeUndefined()
  })

  it('creates the models folder with a note that keeps user edits', () => {
    const models = join(temporary(), '模型')
    ensureModelsDirectory(models, '智办')
    const readme = readFileSync(join(models, 'README.txt'), 'utf8')
    expect(readme).toBe(modelsReadme('智办'))
    expect(readme).toContain('智办 本地模型文件夹')
    expect(readme).toContain(String(LLAMA_CONTEXT_SIZE))
    writeFileSync(join(models, 'README.txt'), 'mine')
    ensureModelsDirectory(models, '智办')
    expect(readFileSync(join(models, 'README.txt'), 'utf8')).toBe('mine')
  })

  it('tells the Profile where the server and folders are, with a fresh key per launch', () => {
    const options = { executable: '/app/llama/bin/llama-server', modelsDirectory: '/data/models', stateDirectory: '/data/llama' }
    const first = localModelsEnvironment(options)
    expect(first).toEqual({
      WORKDSH_LLAMA_SERVER: '/app/llama/bin/llama-server',
      WORKDSH_LLAMA_API_KEY: first.WORKDSH_LLAMA_API_KEY,
      WORKDSH_LLAMA_MODELS_DIR: '/data/models',
      WORKDSH_LLAMA_STATE_DIR: '/data/llama',
      WORKDSH_LLAMA_CONTEXT_SIZE: String(LLAMA_CONTEXT_SIZE),
    })
    expect(first.WORKDSH_LLAMA_API_KEY).toMatch(/^[\w-]{32}$/u)
    expect(localModelsEnvironment(options).WORKDSH_LLAMA_API_KEY).not.toBe(first.WORKDSH_LLAMA_API_KEY)
    expect(localModelsEnvironment({ ...options, apiKey: 'k', contextSize: 8192 })).toMatchObject({ WORKDSH_LLAMA_API_KEY: 'k', WORKDSH_LLAMA_CONTEXT_SIZE: '8192' })
  })
})
