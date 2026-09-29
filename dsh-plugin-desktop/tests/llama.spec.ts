import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LLAMA_CONTEXT_SIZE,
  defaultPresets,
  ensureModelsDirectory,
  freeLoopbackPort,
  llamaExecutable,
  llamaRuntimeEnvironment,
  modelsReadme,
  planLlamaServer,
  serverPath,
  stopLlamaServer,
  waitForLlamaServer,
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

  it('serves the models folder on loopback with the key in the environment', () => {
    const root = temporary()
    const models = join(root, 'models')
    mkdirSync(models)
    const plan = planLlamaServer({
      executable: '/app/llama/bin/llama-server', modelsDirectory: models, stateDirectory: join(root, 'state'), port: 18080, apiKey: 'k', env: { PATH: '/bin' },
    })
    expect(plan.cwd).toBe(models)
    expect(plan.args).toEqual([
      '--host', '127.0.0.1', '--port', '18080', '--models-dir', '.', '--models-preset', join('..', 'state', 'presets.ini'),
      '--models-max', '1', '--sleep-idle-seconds', '600', '--no-webui', '--offline',
    ])
    expect(plan.args).not.toContain('k')
    expect(plan.env).toEqual({ PATH: '/bin', LLAMA_API_KEY: 'k', LLAMA_CACHE: join(root, 'state', 'cache') })
    expect(plan.baseURL).toBe('http://127.0.0.1:18080/v1')
    expect(readFileSync(plan.presets, 'utf8')).toBe(defaultPresets(LLAMA_CONTEXT_SIZE))
    expect(llamaRuntimeEnvironment(plan, models)).toEqual({
      WORKDSH_LLAMA_BASE_URL: 'http://127.0.0.1:18080/v1',
      WORKDSH_LLAMA_API_KEY: 'k',
      WORKDSH_LLAMA_MODELS_DIR: models,
      WORKDSH_LLAMA_CONTEXT_SIZE: String(LLAMA_CONTEXT_SIZE),
    })
  })

  it("prefers the user's presets and generates a fresh key per launch", () => {
    const root = temporary()
    writeFileSync(join(root, 'presets.ini'), 'version = 1\n[*]\nc = 8192\n')
    const options = { executable: 'llama-server', modelsDirectory: root, stateDirectory: join(root, '.state'), port: 1, env: {} }
    const first = planLlamaServer(options)
    const second = planLlamaServer(options)
    expect(first.presets).toBe(join(root, 'presets.ini'))
    expect(first.args).toContain('presets.ini')
    expect(existsSync(join(root, '.state', 'presets.ini'))).toBe(false)
    expect(first.apiKey).toMatch(/^[\w-]{32}$/u)
    expect(second.apiKey).not.toBe(first.apiKey)
  })

  it('passes llama.cpp ASCII paths relative to the models folder when it can', () => {
    const base = join(tmpdir(), '张三', 'WorkDSH')
    const models = join(base, 'models')
    expect(serverPath(models, models)).toBe('.')
    expect(serverPath(join(models, 'presets.ini'), models)).toBe('presets.ini')
    expect(serverPath(join(base, 'llama', 'presets.ini'), models)).toBe(join('..', 'llama', 'presets.ini'))
    // A relative path that is not ASCII gains nothing, so the absolute path stays.
    const elsewhere = join(tmpdir(), '模型设置', 'presets.ini')
    expect(serverPath(elsewhere, models)).toBe(elsewhere)
  })

  it('waits for health and gives up when the server exits', async () => {
    const server = createServer((request, response) => { response.writeHead(request.url === '/health' ? 200 : 404).end() })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = address !== null && typeof address === 'object' ? address.port : 0
    const alive = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'])
    try {
      expect(await waitForLlamaServer(`http://127.0.0.1:${String(port)}/v1`, alive, 5_000)).toBe(true)
    } finally {
      alive.kill()
      await new Promise(resolve => server.close(resolve))
    }
    const dead = spawn(process.execPath, ['-e', 'process.exit(3)'])
    await new Promise(resolve => dead.once('exit', resolve))
    expect(await waitForLlamaServer(`http://127.0.0.1:${String(await freeLoopbackPort())}/v1`, dead, 5_000)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('stops the server together with its model processes', async () => {
    const root = temporary()
    const pidFile = join(root, 'grandchild.pid')
    const script = `const { spawn } = require('node:child_process'); const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000)`
    const router = spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore' })
    for (let attempt = 0; attempt < 100 && !existsSync(pidFile); attempt++) await new Promise(resolve => setTimeout(resolve, 50))
    const grandchild = Number(readFileSync(pidFile, 'utf8'))
    const exited = new Promise(resolve => router.once('exit', resolve))
    stopLlamaServer(router)
    await exited
    let alive = true
    for (let attempt = 0; attempt < 100 && alive; attempt++) {
      try { process.kill(grandchild, 0); await new Promise(resolve => setTimeout(resolve, 50)) } catch { alive = false }
    }
    expect(alive).toBe(false)
  })

  it('finds a free loopback port', async () => {
    const port = await freeLoopbackPort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65536)
  })
})
