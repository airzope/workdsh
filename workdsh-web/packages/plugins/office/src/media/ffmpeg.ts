import { readFileSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-skill";
import skill from "./SKILL.md";

/** FFmpeg executables the media skill hands to the agent. */
export interface MediaTools {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  /** `bundled`: the Desktop runtime; `configured`: WORKDSH_FFMPEG/WORKDSH_FFPROBE; `system`: PATH. */
  readonly source: "bundled" | "configured" | "system";
  readonly version?: string;
  readonly license?: string;
  /** Notable encoders present in the bundled build. */
  readonly encoders?: readonly string[];
}

/** The bundled build's record, written by the Desktop runtime preparation. */
interface MediaManifest {
  readonly version?: unknown;
  readonly license?: unknown;
  readonly encoders?: unknown;
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

function executable(name: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? `${name}.exe` : name;
}

/**
 * Find FFmpeg and FFprobe: the Desktop's bundled build (WORKDSH_MEDIA_TOOLS),
 * explicit WORKDSH_FFMPEG and WORKDSH_FFPROBE paths, or both on PATH.
 * @param env - Host process environment.
 * @param platform - Host platform.
 * @returns The executables, or undefined when FFmpeg is unavailable.
 */
export function locateMediaTools(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): MediaTools | undefined {
  const bundled = env.WORKDSH_MEDIA_TOOLS;
  if (bundled && isAbsolute(bundled)) {
    const ffmpeg = join(bundled, "bin", executable("ffmpeg", platform));
    const ffprobe = join(bundled, "bin", executable("ffprobe", platform));
    if (isFile(ffmpeg) && isFile(ffprobe)) {
      let manifest: MediaManifest = {};
      try {
        manifest = JSON.parse(readFileSync(join(bundled, "manifest.json"), "utf8")) as MediaManifest;
      } catch {
        // The executables are usable without their record.
      }
      return {
        ffmpeg,
        ffprobe,
        source: "bundled",
        ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
        ...(typeof manifest.license === "string" ? { license: manifest.license } : {}),
        ...(Array.isArray(manifest.encoders) ? { encoders: manifest.encoders.filter((name): name is string => typeof name === "string") } : {}),
      };
    }
  }
  const ffmpeg = env.WORKDSH_FFMPEG;
  const ffprobe = env.WORKDSH_FFPROBE;
  if (ffmpeg && ffprobe && isAbsolute(ffmpeg) && isAbsolute(ffprobe) && isFile(ffmpeg) && isFile(ffprobe)) return { ffmpeg, ffprobe, source: "configured" };
  const path = platform === "win32" ? env.Path ?? env.PATH : env.PATH;
  for (const directory of (path ?? "").split(platform === "win32" ? ";" : delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    const found = { ffmpeg: join(directory, executable("ffmpeg", platform)), ffprobe: join(directory, executable("ffprobe", platform)) };
    if (isFile(found.ffmpeg) && isFile(found.ffprobe)) return { ...found, source: "system" };
  }
  return undefined;
}

/**
 * The media skill's instructions followed by where FFmpeg is installed.
 * @param tools - Located executables.
 * @returns Skill body without frontmatter.
 */
export function mediaSkillContent(tools: MediaTools | undefined): string {
  const body = skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "").trim();
  if (tools === undefined) {
    return `${body}\n\n## Installed FFmpeg\n\nFFmpeg is not installed in this deployment. Tell the user that audio and video processing needs FFmpeg and FFprobe: the Desktop app bundles them, and a Web deployment's administrator installs both on the Host's PATH or sets WORKDSH_FFMPEG and WORKDSH_FFPROBE to absolute paths. Do not download FFmpeg yourself.`;
  }
  return `${body}\n\n## Installed FFmpeg\n\nUse these absolute paths for every command.\n\n${JSON.stringify({ ffmpeg: tools }, undefined, 2)}`;
}

/** The skill's routing description from its frontmatter. */
export function mediaSkillDescription(): string {
  const description = /^description:\s*"(.*)"\s*$/mu.exec(skill)?.[1];
  if (!description) throw new Error("media-ffmpeg: SKILL.md has no description");
  return description;
}

/** Register the media skill when the Profile has a skill registry. */
export function registerMediaSkill(ctx: Context, tools: MediaTools | undefined = locateMediaTools()): void {
  ctx.inject(["skills"], (scope) => {
    scope.effect(() => scope.skills.register({
      name: "media-ffmpeg",
      description: mediaSkillDescription(),
      content: mediaSkillContent(tools),
      source: "bundled",
    }), "workdsh-office.media-skill");
  });
}
