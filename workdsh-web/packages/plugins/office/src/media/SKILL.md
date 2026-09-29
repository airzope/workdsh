---
name: media-ffmpeg
description: "Convert, compress, trim without re-encoding, merge, extract audio from, and inspect audio and video files with the bundled FFmpeg and FFprobe. 音视频格式转换、压缩、无损剪辑、截取片段、合并、提取音频、查看时长和编码。Use for mp4, mov, mkv, avi, webm, flv, ts, m4v, mp3, wav, m4a, aac, flac, ogg, opus, and wma files."
---

# Audio and video with FFmpeg

Run FFmpeg and FFprobe with the command tool, always through the absolute paths in **Installed FFmpeg** at the end of this skill, never a bare `ffmpeg` from PATH. On Windows the command tool is PowerShell: call the executable with `&` and quote every path, for example `& "C:\...\ffmpeg.exe" -i "输入.mp4" "输出.mp3"`. In bash, quote paths with double quotes as well; file names often contain spaces and Chinese characters.

## Ground rules

1. **Inspect first.** Before any change, run FFprobe on the input and read the container, duration, streams, codecs, resolution, frame rate, bit rates, and size:
   `ffprobe -v error -show_entries format=duration,size,bit_rate,format_name:stream=index,codec_type,codec_name,profile,width,height,r_frame_rate,bit_rate,channels,sample_rate -of json "input.mp4"`
2. **Never overwrite the input.** Write a new file next to it with a descriptive suffix, such as `会议录像.compressed.mp4`, `会议录像.00m10s-02m30s.mp4`, or `会议录像.mp3`. Pass `-n` so FFmpeg refuses to replace an existing file; choose another name if it does.
3. **Keep the output quiet but visible:** `-hide_banner -loglevel error -stats`. Long encodes can take minutes; tell the user before starting a job longer than about a minute of media at slow presets, and run it so the command tool does not time out.
4. **Copy streams whenever possible.** `-c copy` is lossless and fast. Re-encode only when the target format cannot hold the source codec, when the user asks for smaller files, or when a cut must be frame-accurate.
5. **Verify and report.** After writing, run FFprobe on the output. Tell the user the output path, duration, codecs, resolution, and the size before and after.
6. Check an encoder before relying on it: the installed list below names the notable encoders. If one is missing, use the fallback given in each section.

## Convert

- **Change container only (lossless):** `ffmpeg -hide_banner -loglevel error -stats -n -i "in.mkv" -map 0 -c copy "out.mp4"`. MP4 accepts H.264, H.265, AV1, AAC, MP3, and Opus. If it rejects a stream (for example PCM audio or some subtitles), keep video with `-c:v copy` and re-encode only that stream (`-c:a aac -b:a 192k`, or `-sn` to drop subtitles).
- **Widely playable MP4 (H.264 + AAC):** `-c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart`. Without `libx264`, use `h264_videotoolbox -b:v 5M` on macOS, `h264_mf -b:v 5M` on Windows, or `libopenh264 -b:v 5M`; `mpeg4 -q:v 3` is the last resort.
- **WebM:** `-c:v libvpx-vp9 -crf 32 -b:v 0 -row-mt 1 -c:a libopus -b:a 128k`.
- **Extract or convert audio:** add `-vn`, then MP3 `-c:a libmp3lame -q:a 2`, M4A `-c:a aac -b:a 192k`, WAV `-c:a pcm_s16le`, FLAC `-c:a flac`, Opus `-c:a libopus -b:a 96k`. To keep the original audio untouched, use `-vn -c:a copy` with a matching container (AAC → `.m4a`, MP3 → `.mp3`, Opus → `.opus`).
- **Animated GIF:** two passes with a palette: `-vf "fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0`.
- **Still frame:** `-ss 00:00:05 -i "in.mp4" -frames:v 1 -q:v 2 "frame.jpg"`.

## Compress

- **Default:** H.264 with CRF. `-c:v libx264 -crf 23 -preset medium -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart`. Lower CRF means higher quality: 18–20 visually lossless, 23 balanced, 26–28 small. Slower presets (`slow`) give smaller files at the same quality.
- **Smaller still:** H.265 `-c:v libx265 -crf 28 -preset medium -tag:v hvc1` (Apple players need `hvc1`), or scale down with `-vf "scale=-2:720"` (or 1080/480), reduce frame rate with `-r 30`, and audio to `-b:a 96k`. For chat apps and older devices prefer H.264 + AAC MP4.
- **Target file size:** compute the video bit rate in kbit/s as `target_MiB × 8192 ÷ duration_seconds − audio_kbps`, then encode twice with `-c:v libx264 -b:v <rate>k`: first `-pass 1 -an -f null` (output `NUL` on Windows, `/dev/null` elsewhere), then `-pass 2` with audio. Run both passes in the output's folder and delete the `ffmpeg2pass-*` logs afterwards.
- **Audio only:** MP3 `-c:a libmp3lame -q:a 5`, AAC `-b:a 96k`, or Opus `-b:a 48k` for speech.
- If the result is not smaller than the input, say so and keep the original rather than delivering a worse copy.

## Trim without re-encoding (无损剪辑)

- **Cut one range:** `ffmpeg -hide_banner -loglevel error -n -ss 00:01:10 -to 00:02:30 -i "in.mp4" -map 0 -c copy -avoid_negative_ts make_zero "in.01m10s-02m30s.mp4"`. With `-ss` before `-i`, `-to` counts from the original timeline.
- Stream copy can only start at a video keyframe, so the clip may begin up to a few seconds before the requested time. When the user needs the exact start, list the keyframes near it and offer the nearest one:
  `ffprobe -v error -select_streams v:0 -skip_frame nokey -show_entries frame=pts_time -of csv=p=0 -read_intervals 60%+20 "in.mp4"` (keyframes between 60 s and 80 s).
- If the user insists on a frame-accurate start, re-encode that clip (`-c:v libx264 -crf 18 -c:a aac`) and say that it is no longer lossless.
- Audio-only files cut losslessly at any point for MP3, AAC, and FLAC with `-c copy`.
- **Keep several ranges or remove a middle part:** cut each kept range losslessly, then join them.

## Join

- **Same codecs and parameters (lossless):** write a list file in the output folder, one line per clip, `file '/absolute/path/part1.mp4'` (escape single quotes in names as `'\''`), then `ffmpeg -hide_banner -loglevel error -n -f concat -safe 0 -i "list.txt" -c copy "joined.mp4"`. Delete the list file afterwards.
- **Different codecs, sizes, or frame rates:** re-encode with the concat filter, scaling to a common size first, for example `-filter_complex "[0:v]scale=1280:720,setsar=1[v0];[1:v]scale=1280:720,setsar=1[v1];[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac`.

## Other common edits

- Remove audio `-an`; replace audio `-i "video.mp4" -i "music.mp3" -map 0:v -map 1:a -c:v copy -c:a aac -shortest`.
- Rotate 90° clockwise `-vf "transpose=1"` (re-encodes); change speed 2× `-filter_complex "[0:v]setpts=0.5*PTS[v];[0:a]atempo=2.0[a]" -map "[v]" -map "[a]"`.
- Normalize loudness for speech `-af loudnorm=I=-16:TP=-1.5:LRA=11`; convert to 16 kHz mono WAV for transcription `-ar 16000 -ac 1 -c:a pcm_s16le`.
- Burn subtitles `-vf "subtitles='subs.srt'"` requires `libass`; otherwise add them as a soft track with `-c:s mov_text` in MP4.

## Failure handling

- Read FFmpeg's error line and fix the cause (unsupported codec in container, missing encoder, odd width with `yuv420p` — use `scale=-2:<height>`), rather than retrying blindly.
- Encrypted or DRM-protected media cannot be processed; say so.
- Disk space: a re-encode needs room for the full output; check free space before very large jobs.
