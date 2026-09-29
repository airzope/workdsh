# Agent Note: Bundled FFmpeg for audio and video

Status: implemented

English | [中文](2026-09-29-bundled-ffmpeg.zh.md)

## Decision

Every Desktop installer carries FFmpeg 8.1.2 and FFprobe in `workdsh-runtime/media/bin/`, and the WorkDSH Office plugin registers a `media-ffmpeg` skill. The skill covers inspection, conversion, compression, lossless trimming (stream copy from a keyframe), joining, and audio extraction. The agent runs the commands through DSH's command tool, so the session's approval and sandbox policy apply. No separate media tool bypasses them.

This follows upstream's own pattern for bundled runtimes: `dsh-skill-office` appends the absolute LibreOffice Kit paths to its skill text, and `load_workspace_dependencies` returns interpreter paths without changing PATH. The carrier passes `WORKDSH_MEDIA_TOOLS` to the runtime. The Office plugin locates the executables in this order:

1. `bin/ffmpeg` and `bin/ffprobe` in that directory, together with its `manifest.json`;
2. `WORKDSH_FFMPEG` and `WORKDSH_FFPROBE`;
3. PATH.

It appends the result to the skill text. When nothing is found, the skill tells the agent to explain this to the user and not to download FFmpeg.

## Build

`scripts/prepare-workdsh-media.ts` runs after the primary runtime is prepared. It downloads the pinned build for the host from Shaka Project's `static-ffmpeg-binaries` `n8.1.2-1` and checks it against a SHA-256 recorded per target. That project uses one public pipeline and one configuration for all five targets, with `--enable-gpl --enable-version3` and x264, x265, libvpx, SVT-AV1, Opus, LAME, and Mbed TLS.

The script then runs `ffmpeg -encoders` and fails if a required encoder is missing. It writes `manifest.json` (version, license, target, encoders), `COPYING.GPLv3`, and `SOURCES.md`, which lists every upstream source and the build-script commit.

Why this build:

- **Windows:** links msvcrt and imports nothing newer than Windows 7, so it needs neither the UCRT nor VxKex.
- **Linux:** fully static (musl), so it has no glibc requirement.
- **macOS:** both builds set a minimum of macOS 15.0.
- **Alternatives:**
  - BtbN keeps only rolling tags, and its Windows build needs VxKex.
  - gyan.dev's builds are larger and do not publish their dependency build scripts.
  - `ffmpeg-static` downloads at install time and mixes providers.

The build has no zlib, so it has no PNG encoder; still frames use JPEG.

## Gates

- **Offline files:** the Linux, macOS, and Windows 7 audits require `media/manifest.json`, `bin/ffmpeg`, and `bin/ffprobe`. On Linux and macOS they must also be target-architecture images. The existing checks for glibc, `minos` and Windows 7 imports cover them like every other binary.
- **Runtime smoke:** `scripts/smoke-media.mjs` synthesizes a clip with a Chinese file name that contains a space. It then:
  - cuts it with `-c copy` and checks the duration and codecs;
  - converts the audio to MP3;
  - compresses the clip and checks that the file got smaller;
  - checks that the packaged Office plugin hands the bundled paths to the skill.

  The Ubuntu container smoke and the macOS DMG smoke run it, and so does the post-fuse packaging check, which is the only runtime check on Windows.

## Licensing

The executables are GPLv3. WorkDSH runs them as separate programs and does not link them, so its own license is unaffected. The GPL text and `SOURCES.md` ship next to the executables, and THIRD_PARTY_NOTICES records the build.

Shaka publishes build scripts but not source archives. The CI job `ffmpeg-sources` runs `scripts/pack-ffmpeg-sources.ts`, which fetches every component at its pinned tag or commit and checks the LAME tarball against a pinned SHA-256. It uploads the result as `dsh-plugin-desktop-ffmpeg-sources`, so each Desktop release attaches `ffmpeg-8.1.2-corresponding-source.tar.gz` next to the installers.

## Upgrades

Shaka's macOS builds inherit the runner's SDK instead of a pinned deployment target. On every version bump:

- recompute the checksums;
- re-run the macOS audit, whose minimum macOS must stay at or below 15.0;
- re-run the Windows 7 import check;
- update `SOURCES.md` from Shaka's `versions.txt`.
