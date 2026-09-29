// Exercise the bundled llama-server headlessly in router mode: serve a models
// folder whose path has Chinese and a space, require the API key, pick up a
// model added after start, and answer a chat completion with a tiny model.
// Usage: node smoke-llama.mjs <llama directory>
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeTinyGguf } from './tiny-gguf.mjs'

const [llama] = process.argv.slice(2)
if (!llama) throw new Error('Usage: node smoke-llama.mjs <llama directory>')
const manifest = JSON.parse(readFileSync(join(llama, 'manifest.json'), 'utf8'))
const server = join(llama, manifest.server)

const version = spawnSync(server, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
if (version.status !== 0 || !`${version.stdout}${version.stderr}`.includes(manifest.version.replace(/^b/u, ''))) {
  throw new Error(`llama-server --version failed: ${String(version.error ?? `${version.stdout}${version.stderr}`)}`)
}

const port = await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address()
    probe.close(() => resolve(free))
  })
})
const key = `smoke-${String(process.pid)}`
const base = `http://127.0.0.1:${String(port)}`
const work = mkdtempSync(join(tmpdir(), 'workdsh-llama-'))
const models = join(work, '本地 模型')
mkdirSync(models)
writeTinyGguf(join(models, 'workdsh-smoke.gguf'))

let log = ''
const child = spawn(server, ['--host', '127.0.0.1', '--port', String(port), '--models-dir', models, '--models-max', '1', '--no-webui', '--offline'], {
  env: { ...process.env, LLAMA_API_KEY: key, LLAMA_CACHE: join(work, 'cache') },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
  windowsHide: true,
})
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = `${log}${String(chunk)}`.slice(-8_192) })

function stop() {
  if (child.exitCode !== null || child.pid === undefined) return
  // Model instances are child processes of the router.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  else process.kill(-child.pid, 'SIGTERM')
}

async function request(path, { auth = true, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { authorization: `Bearer ${key}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  return { status: response.status, json: await response.json().catch(() => undefined) }
}

const ids = listing => (listing?.data ?? []).map(model => model.id).sort()

try {
  const deadline = Date.now() + 60_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`llama-server exited with ${String(child.exitCode)}`)
    const health = await fetch(`${base}/health`).then(response => response.status, () => 0)
    if (health === 200) break
    if (Date.now() > deadline) throw new Error('llama-server did not become healthy within 60 s')
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  const anonymous = await request('/v1/models', { auth: false })
  if (anonymous.status !== 401) throw new Error(`Listing models without the key returned ${String(anonymous.status)}`)
  const first = await request('/v1/models')
  if (JSON.stringify(ids(first.json)) !== JSON.stringify(['workdsh-smoke'])) throw new Error(`Unexpected models: ${JSON.stringify(first.json)}`)

  writeTinyGguf(join(models, 'workdsh-smoke-2.gguf'), 'workdsh-smoke-2')
  const reloaded = await request('/v1/models?reload=1')
  if (JSON.stringify(ids(reloaded.json)) !== JSON.stringify(['workdsh-smoke', 'workdsh-smoke-2'])) {
    throw new Error(`A model added to the folder was not listed after reload: ${JSON.stringify(reloaded.json)}`)
  }

  const completion = await request('/v1/chat/completions', {
    body: { model: 'workdsh-smoke-2', messages: [{ role: 'user', content: '你好 hello' }], max_tokens: 4 },
  })
  const message = completion.json?.choices?.[0]?.message
  if (completion.status !== 200 || message?.role !== 'assistant' || typeof message.content !== 'string') {
    throw new Error(`Chat completion failed (${String(completion.status)}): ${JSON.stringify(completion.json)}`)
  }
  console.log(`llama.cpp ${String(manifest.version)} (${String(manifest.target)}, ${String(manifest.accelerator)}) served ${String(ids(reloaded.json).length)} models and answered a chat completion`)
} catch (error) {
  console.error(log)
  throw error
} finally {
  stop()
  await new Promise(resolve => setTimeout(resolve, 500))
  // Windows may hold the models open briefly after the processes end; a
  // leftover temporary folder does not fail the smoke.
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (error) {
    console.warn(`Could not remove ${work}: ${String(error)}`)
  }
}
