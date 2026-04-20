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
  getCompositionDuration,
  parseAudioElements,
  processCompositionAudio,
} from "@hyperframes/engine";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLIENT_PUBLIC = path.resolve(ROOT, "..", "client", "public");

const TOTAL_DURATION_REF = { value: 0 };

const WIDTH = 376;
const HEIGHT = 596;
const FPS = 120;

const VITE_HOST = "127.0.0.1";
const VITE_PORT = 5180;

type CliArgs = {
  gameId: number | null;
  numsPrice: number;
};

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  let gameId: number | null = null;
  let numsPrice = 0.01138;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--game-id" || arg === "-g") {
      gameId = Number.parseInt(args[++i] ?? "", 10);
    } else if (arg === "--nums-price" || arg === "-p") {
      numsPrice = Number.parseFloat(args[++i] ?? "");
    } else if (arg.startsWith("{")) {
      try {
        const parsed = JSON.parse(arg) as {
          gameId?: number;
          numsPrice?: number;
        };
        if (parsed.gameId != null) gameId = parsed.gameId;
        if (parsed.numsPrice != null) numsPrice = parsed.numsPrice;
      } catch (_e) {
        void _e;
      }
    }
  }

  if (process.env.GAME_ID) gameId = Number.parseInt(process.env.GAME_ID, 10);
  if (process.env.NUMS_PRICE)
    numsPrice = Number.parseFloat(process.env.NUMS_PRICE);

  if (!Number.isFinite(numsPrice)) numsPrice = 0.01138;
  if (gameId !== null && !Number.isFinite(gameId)) gameId = null;

  return { gameId, numsPrice };
}

const CLI = parseCliArgs();
const QS = new URLSearchParams();
if (CLI.gameId != null) QS.set("gameId", String(CLI.gameId));
QS.set("numsPrice", String(CLI.numsPrice));
const VITE_URL = `http://${VITE_HOST}:${VITE_PORT}/?${QS.toString()}`;
const FRAMES_DIR = path.resolve(ROOT, "out", "frames");
const VIDEO_ONLY_MP4 = path.resolve(ROOT, "out", "video-only.mp4");
const AUDIO_OUT = path.resolve(ROOT, "out", "audio.m4a");
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

  console.log(
    `[render] gameId=${CLI.gameId ?? "(fixtures)"} numsPrice=${CLI.numsPrice}`,
  );
  console.log(`[render] Starting Vite dev server on ${VITE_URL}...`);
  const vite = startViteServer();

  let pageHtml: string | null = null;

  try {
    await waitForUrl(VITE_URL);
    console.log(`[render] Vite ready.`);

    const chromeArgs = buildChromeArgs({
      width: WIDTH,
      height: HEIGHT,
      captureMode: "beginframe",
    });

    console.log(`[render] Acquiring headless browser...`);
    const acquired = await acquireBrowser(chromeArgs);

    try {
      console.log(`[render] Creating capture session...`);
      const session = await createCaptureSession(VITE_URL, FRAMES_DIR, {
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        format: "png",
      });

      try {
        await initializeSession(session);

        const duration = await getCompositionDuration(session);
        const totalFrames = Math.round(duration * FPS);
        console.log(
          `[render] Composition duration=${duration.toFixed(
            2,
          )}s totalFrames=${totalFrames} @${FPS}fps`,
        );

        for (let i = 0; i < totalFrames; i++) {
          const time = i / FPS;
          await captureFrame(session, i, time);
          if (i % 60 === 0 || i === totalFrames - 1) {
            console.log(
              `[render]   frame ${i + 1}/${totalFrames} (t=${time.toFixed(3)}s)`,
            );
          }
        }

        TOTAL_DURATION_REF.value = duration;
        pageHtml = await session.page.content();
      } finally {
        await closeCaptureSession(session);
      }
    } finally {
      await releaseBrowser(acquired.browser);
    }

    console.log(`[render] Encoding video (no audio) with ffmpeg...`);
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
      console.log(`[render] Found ${audioElements.length} audio elements.`);
      if (audioElements.length > 0) {
        console.log(`[render] Mixing audio tracks...`);
        const mixResult = await processCompositionAudio(
          audioElements,
          CLIENT_PUBLIC,
          AUDIO_WORK,
          AUDIO_OUT,
          TOTAL_DURATION_REF.value,
        );
        if (mixResult.success) {
          console.log(`[render] Muxing video + audio into final MP4...`);
          await runFfmpeg([
            "-y",
            "-i",
            VIDEO_ONLY_MP4,
            "-i",
            AUDIO_OUT,
            "-c:v",
            "copy",
            "-c:a",
            "copy",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-movflags",
            "+faststart",
            OUTPUT_MP4,
          ]);
          await unlink(VIDEO_ONLY_MP4).catch(() => {});
          await unlink(AUDIO_OUT).catch(() => {});
        } else {
          console.warn(
            `[render] Audio mix failed (${mixResult.error}), falling back to silent video.`,
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

    console.log(`[render] ✅ Wrote ${OUTPUT_MP4}`);
  } finally {
    console.log(`[render] Stopping Vite dev server (SIGKILL)...`);
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
