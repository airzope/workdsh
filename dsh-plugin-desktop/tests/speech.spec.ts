import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { speechEnvironment } from '../src/speech.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('bundled speech-to-text weights', () => {
  it('names the staged folder and VAD only when the build has them', () => {
    const root = mkdtempSync(join(tmpdir(), 'workdsh-speech-'))
    roots.push(root)
    expect(speechEnvironment(root)).toEqual({})
    writeFileSync(join(root, 'manifest.json'), '{}')
    expect(speechEnvironment(root)).toEqual({
      WORKDSH_SENSEVOICE_MODEL_DIR: root,
      WORKDSH_SENSEVOICE_VAD: join(root, 'silero_vad.onnx'),
    })
  })
})
