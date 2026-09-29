import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { locateMediaTools, mediaSkillContent, mediaSkillDescription } from '../../packages/plugins/office/dist/index.js';

async function executables(directory, platform) {
  await mkdir(directory, { recursive: true });
  const suffix = platform === 'win32' ? '.exe' : '';
  for (const name of ['ffmpeg', 'ffprobe']) await writeFile(join(directory, `${name}${suffix}`), '');
}

test('media skill prefers the bundled FFmpeg, then configured paths, then PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-media-'));
  try {
    const bundled = join(root, 'media');
    await executables(join(bundled, 'bin'), process.platform);
    await writeFile(join(bundled, 'manifest.json'), JSON.stringify({ version: '8.0', license: 'GPL-3.0-or-later', encoders: ['libx264', 'aac', 7] }));
    const system = join(root, 'system');
    await executables(system, process.platform);
    const exe = name => process.platform === 'win32' ? `${name}.exe` : name;

    assert.deepEqual(locateMediaTools({ WORKDSH_MEDIA_TOOLS: bundled, PATH: system, Path: system }), {
      ffmpeg: join(bundled, 'bin', exe('ffmpeg')), ffprobe: join(bundled, 'bin', exe('ffprobe')),
      source: 'bundled', version: '8.0', license: 'GPL-3.0-or-later', encoders: ['libx264', 'aac'],
    });
    assert.deepEqual(locateMediaTools({ WORKDSH_FFMPEG: join(system, exe('ffmpeg')), WORKDSH_FFPROBE: join(system, exe('ffprobe')) }), {
      ffmpeg: join(system, exe('ffmpeg')), ffprobe: join(system, exe('ffprobe')), source: 'configured',
    });
    assert.equal(locateMediaTools({ WORKDSH_MEDIA_TOOLS: join(root, 'missing'), PATH: system, Path: system })?.source, 'system');
    assert.equal(locateMediaTools({ PATH: join(root, 'empty'), Path: join(root, 'empty') }), undefined);

    const content = mediaSkillContent(locateMediaTools({ WORKDSH_MEDIA_TOOLS: bundled }));
    assert.doesNotMatch(content, /^---/);
    assert.match(content, /## Trim without re-encoding/);
    assert.ok(content.includes(JSON.stringify(join(bundled, 'bin', exe('ffmpeg')))));
    assert.match(mediaSkillContent(undefined), /FFmpeg is not installed in this deployment/);
    assert.match(mediaSkillDescription(), /无损剪辑/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
