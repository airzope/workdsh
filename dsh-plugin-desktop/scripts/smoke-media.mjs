// Exercise the bundled FFmpeg headlessly: synthesize a clip, cut it without
// re-encoding, convert its audio, compress it, and check that the packaged
// Office plugin hands these executables to the media skill.
// Usage: node smoke-media.mjs <media directory> <workdsh-plugin-office directory>
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [media, office] = process.argv.slice(2)
if (!media || !office) throw new Error('Usage: node smoke-media.mjs <media directory> <workdsh-plugin-office directory>')
const exe = name => join(media, 'bin', process.platform === 'win32' ? `${name}.exe` : name)
const ffmpeg = exe('ffmpeg')
const ffprobe = exe('ffprobe')
const manifest = JSON.parse(readFileSync(join(media, 'manifest.json'), 'utf8'))
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 120_000 })
const probe = path => JSON.parse(run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', path]))
const codecs = info => Object.fromEntries(info.streams.map(stream => [stream.codec_type, stream.codec_name]))

const version = run(ffmpeg, ['-hide_banner', '-version']).split('\n')[0]
if (!version.startsWith('ffmpeg version')) throw new Error(`Unexpected ffmpeg -version output: ${version}`)
const video = manifest.encoders.includes('libx264') ? ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'] : ['-c:v', 'mpeg4']
const audio = manifest.encoders.includes('libmp3lame') ? ['libmp3lame', 'mp3'] : ['aac', 'aac']
const work = mkdtempSync(join(tmpdir(), 'workdsh-media-'))
try {
  const source = join(work, '源 视频.mp4')
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '4', ...video, '-g', '25', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', source])
  const cut = join(work, '源 视频.00m01s-00m03s.mp4')
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-ss', '1', '-to', '3', '-i', source, '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', cut])
  const cutInfo = probe(cut)
  const duration = Number(cutInfo.format.duration)
  if (!(duration > 1.5 && duration < 3.1)) throw new Error(`Lossless cut lasted ${String(duration)} s`)
  if (JSON.stringify(codecs(cutInfo)) !== JSON.stringify(codecs(probe(source)))) throw new Error('The lossless cut changed codecs')
  const sound = join(work, `源 视频.${audio[1]}`)
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-i', source, '-vn', '-c:a', audio[0], sound])
  if (JSON.stringify(codecs(probe(sound))) !== JSON.stringify({ audio: audio[1] })) throw new Error(`Audio conversion produced ${JSON.stringify(codecs(probe(sound)))}`)
  const small = join(work, '源 视频.compressed.mp4')
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-i', source, ...video, ...(video[1] === 'libx264' ? ['-crf', '32'] : ['-q:v', '12']), '-vf', 'scale=-2:120', '-c:a', 'aac', '-b:a', '48k', small])
  if (statSync(small).size >= statSync(source).size) throw new Error('Compression did not reduce the file size')

  const { locateMediaTools, mediaSkillContent } = await import(pathToFileURL(join(office, 'dist', 'index.js')).href)
  const located = locateMediaTools({ WORKDSH_MEDIA_TOOLS: media })
  if (located?.source !== 'bundled' || located.ffmpeg !== ffmpeg || located.ffprobe !== ffprobe) throw new Error(`Office located ${JSON.stringify(located)}`)
  if (!mediaSkillContent(located).includes(JSON.stringify(ffmpeg))) throw new Error('The media skill does not name the bundled FFmpeg')
  console.log(`${version}: cut ${duration.toFixed(2)} s losslessly, converted audio to ${audio[1]}, compressed ${String(statSync(source).size)} → ${String(statSync(small).size)} bytes`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
