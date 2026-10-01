/**
 * Bundled speech-to-text weights. The installers carry SenseVoiceSmall INT4,
 * its tokens and the Silero VAD in workdsh-runtime/speech/sensevoice; the
 * WorkDSH Profile points DSH's local SenseVoice provider at them, so Voice
 * Input works without downloading a model.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Variables naming the bundled weights, or none when this build has none.
 * @param directory - workdsh-runtime/speech/sensevoice.
 */
export function speechEnvironment(directory: string): Record<string, string> {
  if (!existsSync(join(directory, 'manifest.json'))) return {}
  return {
    WORKDSH_SENSEVOICE_MODEL_DIR: directory,
    WORKDSH_SENSEVOICE_VAD: join(directory, 'silero_vad.onnx'),
  }
}
