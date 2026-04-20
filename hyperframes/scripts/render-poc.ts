import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireBrowser,
  releaseBrowser,
  buildChromeArgs,
  createCaptureSession,
  initializeSession,
  captureFrame,
  closeCaptureSession,
  parseAudioElements,
  processCompositionAudio,
  muxVideoWithAudio,
} from "@hyperframes/engine";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLIENT_PUBLIC = path.resolve(ROOT, "..", "client", "public");

const WIDTH = 376;
const HEIGHT = 596;
const FPS = 120;
const FRAMES_PER_STATE = 40;
const INTRO_FRAMES = 60;
const OUTRO_FRAMES = 60;
const SNAPSHOT_COUNT = 3;
const TOTAL_FRAMES =
  INTRO_FRAMES + SNAPSHOT_COUNT * FRAMES_PER_STATE + OUTRO_FRAMES;
const TOTAL_DURATION = TOTAL_FRAMES / FPS;

const VITE_HOST = "127.0.0.1";
const VITE_PORT = 5180;
const VITE_URL = `http://${VITE_HOST}:${VITE_PORT}/`;
const FRAMES_DIR = path.resolve(ROOT, "out", "frames");
const VIDEO_ONLY_MP4 = path.resolve(ROOT, "out", "video-only.mp4");
const AUDIO_WAV = path.resolve(ROOT, "out", "audio.wav");
const AUDIO_WORK = path.resolve(ROOT, "out", "audio-work");
const OUTPUT_MP4 = path.resolve(ROOT, "out", "game-replay.mp4");

async function waitForUrl(url: string, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_e) {
      void _e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

function startViteServer(): ChildProcess {
  const proc = spawn("pnpm", ["dev"], {
    cwd: ROOT,
    stdio: "pipe",
    detached: true,
    env: { ...process.env, NO_COLOR: "1" },
  });
  proc.stdout?.on("data", (d) => process.stdout.write(`[vite] ${d}`));
  proc.stderr?.on("data", (d) => process.stderr.write(`[vite!] ${d}`));
  return proc;
}

async function main() {
  if (existsSync(FRAMES_DIR)) {
    await rm(FRAMES_DIR, { recursive: true, force: true });
  }
  await mkdir(FRAMES_DIR, { recursive: true });
  if (existsSync(AUDIO_WORK)) {
    await rm(AUDIO_WORK, { recursive: true, force: true });
  }

  console.log(`[poc] Starting Vite dev server on ${VITE_URL}...`);
  const vite = startViteServer();

  let pageHtml: string | null = null;

  try {
    await waitForUrl(VITE_URL);
    console.log(`[poc] Vite ready.`);

    const chromeArgs = buildChromeArgs({
      width: WIDTH,
      height: HEIGHT,
      captureMode: "beginframe",
    });

    console.log(`[poc] Acquiring headless browser...`);
    const acquired = await acquireBrowser(chromeArgs);

    try {
      console.log(`[poc] Creating capture session...`);
      const session = await createCaptureSession(VITE_URL, FRAMES_DIR, {
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        format: "png",
      });

      try {
        await initializeSession(session);
        console.log(
          `[poc] Session initialized. Capturing ${TOTAL_FRAMES} frames @${FPS}fps...`,
        );

        for (let i = 0; i < TOTAL_FRAMES; i++) {
          const time = i / FPS;
          await captureFrame(session, i, time);
          if (i % 30 === 0 || i === TOTAL_FRAMES - 1) {
            console.log(
              `[poc]   frame ${i + 1}/${TOTAL_FRAMES} (t=${time.toFixed(3)}s)`,
            );
          }
        }

        pageHtml = await session.page.content();
      } finally {
        await closeCaptureSession(session);
      }
    } finally {
      await releaseBrowser(acquired.browser);
    }

    console.log(`[poc] Encoding video (no audio) with ffmpeg...`);
    await runFfmpeg([
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      path.join(FRAMES_DIR, "frame_%06d.png"),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "medium",
      "-movflags",
      "+faststart",
      VIDEO_ONLY_MP4,
    ]);

    if (pageHtml) {
      const audioElements = parseAudioElements(pageHtml);
      console.log(`[poc] Found ${audioElements.length} audio elements.`);
      if (audioElements.length > 0) {
        console.log(`[poc] Mixing audio tracks...`);
        const mixResult = await processCompositionAudio(
          audioElements,
          CLIENT_PUBLIC,
          AUDIO_WORK,
          AUDIO_WAV,
          TOTAL_DURATION,
        );
        if (mixResult.success) {
          console.log(`[poc] Muxing video + audio into final MP4...`);
          const muxResult = await muxVideoWithAudio(
            VIDEO_ONLY_MP4,
            AUDIO_WAV,
            OUTPUT_MP4,
          );
          if (!muxResult.success) {
            throw new Error(`Mux failed: ${muxResult.error}`);
          }
          await unlink(VIDEO_ONLY_MP4).catch(() => {});
          await unlink(AUDIO_WAV).catch(() => {});
        } else {
          console.warn(
            `[poc] Audio mix failed (${mixResult.error}), falling back to silent video.`,
          );
          await rm(OUTPUT_MP4, { force: true });
          await copyFile(VIDEO_ONLY_MP4, OUTPUT_MP4);
        }
      } else {
        await rm(OUTPUT_MP4, { force: true });
        await copyFile(VIDEO_ONLY_MP4, OUTPUT_MP4);
      }
    } else {
      await rm(OUTPUT_MP4, { force: true });
      await copyFile(VIDEO_ONLY_MP4, OUTPUT_MP4);
    }

    console.log(`[poc] ✅ Wrote ${OUTPUT_MP4}`);
  } finally {
    console.log(`[poc] Stopping Vite dev server (SIGKILL)...`);
    try {
      if (vite.pid) process.kill(-vite.pid, "SIGKILL");
    } catch (_e) {
      void _e;
    }
    vite.kill("SIGKILL");
  }
}

async function copyFile(src: string, dst: string): Promise<void> {
  const buf = await readFile(src);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(dst, buf);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "inherit" });
    proc.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited with code ${code}`)),
    );
    proc.on("error", reject);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
