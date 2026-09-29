/**
 * Write a tiny random-weight llama GGUF model for smoke tests. Its
 * SentencePiece vocabulary holds only the special tokens and the 256 byte
 * tokens, so every text tokenizes by byte fallback and the file stays a few
 * tens of kilobytes. The output is noise; only loading and serving matter.
 */

import { writeFileSync } from 'node:fs'

const ALIGNMENT = 32
const TYPE = { UINT32: 4, FLOAT32: 6, STRING: 8, ARRAY: 9, INT32: 5 }

class Writer {
  parts = []
  u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); this.parts.push(b) }
  i32(value) { const b = Buffer.alloc(4); b.writeInt32LE(value); this.parts.push(b) }
  u64(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); this.parts.push(b) }
  f32(value) { const b = Buffer.alloc(4); b.writeFloatLE(value); this.parts.push(b) }
  string(value) { const bytes = Buffer.from(value, 'utf8'); this.u64(bytes.length); this.parts.push(bytes) }
  get length() { return this.parts.reduce((total, part) => total + part.length, 0) }
  pad() { const extra = (ALIGNMENT - (this.length % ALIGNMENT)) % ALIGNMENT; if (extra > 0) this.parts.push(Buffer.alloc(extra)) }
  bytes() { return Buffer.concat(this.parts) }
}

/** Deterministic small weights. */
function weights(count, seed) {
  const values = new Float32Array(count)
  let state = seed >>> 0 || 1
  for (let index = 0; index < count; index++) {
    state ^= state << 13; state >>>= 0
    state ^= state >>> 17
    state ^= state << 5; state >>>= 0
    values[index] = ((state / 0xffffffff) - 0.5) * 0.04
  }
  return values
}

/**
 * Build the model bytes.
 * @param {string} name - `general.name`.
 * @returns {Buffer}
 */
export function tinyGguf(name = 'workdsh-smoke') {
  const embedding = 16
  const heads = 2
  const layers = 1
  const feedForward = 32
  const tokens = ['<unk>', '<s>', '</s>', ...Array.from({ length: 256 }, (_, byte) => `<0x${byte.toString(16).toUpperCase().padStart(2, '0')}>`)]
  const types = [2, 3, 3, ...Array.from({ length: 256 }, () => 6)]

  const kv = [
    ['general.architecture', TYPE.STRING, 'llama'],
    ['general.name', TYPE.STRING, name],
    ['general.file_type', TYPE.UINT32, 0],
    ['llama.context_length', TYPE.UINT32, 65536],
    ['llama.embedding_length', TYPE.UINT32, embedding],
    ['llama.block_count', TYPE.UINT32, layers],
    ['llama.feed_forward_length', TYPE.UINT32, feedForward],
    ['llama.attention.head_count', TYPE.UINT32, heads],
    ['llama.attention.head_count_kv', TYPE.UINT32, heads],
    ['llama.rope.dimension_count', TYPE.UINT32, embedding / heads],
    ['llama.attention.layer_norm_rms_epsilon', TYPE.FLOAT32, 1e-5],
    ['tokenizer.ggml.model', TYPE.STRING, 'llama'],
    ['tokenizer.ggml.tokens', TYPE.ARRAY, [TYPE.STRING, tokens]],
    ['tokenizer.ggml.scores', TYPE.ARRAY, [TYPE.FLOAT32, tokens.map(() => 0)]],
    ['tokenizer.ggml.token_type', TYPE.ARRAY, [TYPE.INT32, types]],
    ['tokenizer.ggml.unknown_token_id', TYPE.UINT32, 0],
    ['tokenizer.ggml.bos_token_id', TYPE.UINT32, 1],
    ['tokenizer.ggml.eos_token_id', TYPE.UINT32, 2],
    ['tokenizer.chat_template', TYPE.STRING, "{%- for m in messages %}<|{{ m['role'] }}|>{{ m['content'] if m['content'] is string else '' }}\n{%- endfor %}{%- if add_generation_prompt %}<|assistant|>{%- endif %}"],
  ]

  // Shapes are ggml order: the innermost dimension first.
  const tensors = [['token_embd.weight', [embedding, tokens.length]], ['output_norm.weight', [embedding]]]
  for (let layer = 0; layer < layers; layer++) {
    const prefix = `blk.${String(layer)}.`
    tensors.push(
      [`${prefix}attn_norm.weight`, [embedding]],
      [`${prefix}attn_q.weight`, [embedding, embedding]],
      [`${prefix}attn_k.weight`, [embedding, embedding]],
      [`${prefix}attn_v.weight`, [embedding, embedding]],
      [`${prefix}attn_output.weight`, [embedding, embedding]],
      [`${prefix}ffn_norm.weight`, [embedding]],
      [`${prefix}ffn_gate.weight`, [embedding, feedForward]],
      [`${prefix}ffn_up.weight`, [embedding, feedForward]],
      [`${prefix}ffn_down.weight`, [feedForward, embedding]],
    )
  }

  const writer = new Writer()
  writer.parts.push(Buffer.from('GGUF', 'latin1'))
  writer.u32(3)
  writer.u64(tensors.length)
  writer.u64(kv.length)
  for (const [key, type, value] of kv) {
    writer.string(key)
    writer.u32(type)
    if (type === TYPE.STRING) writer.string(value)
    else if (type === TYPE.UINT32) writer.u32(value)
    else if (type === TYPE.FLOAT32) writer.f32(value)
    else {
      const [itemType, items] = value
      writer.u32(itemType)
      writer.u64(items.length)
      for (const item of items) {
        if (itemType === TYPE.STRING) writer.string(item)
        else if (itemType === TYPE.FLOAT32) writer.f32(item)
        else writer.i32(item)
      }
    }
  }
  const data = []
  let offset = 0
  tensors.forEach(([tensor, shape], index) => {
    const count = shape.reduce((product, size) => product * size, 1)
    const values = tensor.endsWith('norm.weight') ? new Float32Array(count).fill(1) : weights(count, index + 1)
    writer.string(tensor)
    writer.u32(shape.length)
    for (const size of shape) writer.u64(size)
    writer.u32(0) // F32
    writer.u64(offset)
    const bytes = Buffer.from(values.buffer)
    const padding = (ALIGNMENT - (bytes.length % ALIGNMENT)) % ALIGNMENT
    data.push(bytes, Buffer.alloc(padding))
    offset += bytes.length + padding
  })
  writer.pad()
  writer.parts.push(...data)
  return writer.bytes()
}

/**
 * Write the model to a file.
 * @param {string} path - Destination, conventionally ending in `.gguf`.
 * @param {string} [name] - `general.name`.
 */
export function writeTinyGguf(path, name) {
  writeFileSync(path, tinyGguf(name))
}
