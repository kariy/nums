import { createRoot } from "react-dom/client";
import { Replay } from "./replay";
import { POC_SNAPSHOTS } from "./fixtures";
import { frameStore } from "./frame-store";
import { installHyperframesProtocol } from "./hf-protocol";
import { fetchGameReplay } from "./data/torii";
import { loadFonts } from "./fonts";
import type { GameSnapshot } from "./types";
import "./styles.css";

const FPS = 120;
const FRAMES_PER_STATE = 120;
const INTRO_FRAMES = 600;
const OUTRO_FRAMES = 600;

function readParams() {
  const params = new URLSearchParams(window.location.search);
  const gameIdStr = params.get("gameId");
  const gameId = gameIdStr ? Number.parseInt(gameIdStr, 10) : null;
  const numsPriceStr = params.get("numsPrice");
  const numsPrice = numsPriceStr ? Number.parseFloat(numsPriceStr) : 0.01138;
  return { gameId, numsPrice };
}

async function loadSnapshots(gameId: number | null): Promise<GameSnapshot[]> {
  if (gameId == null) return POC_SNAPSHOTS;
  return fetchGameReplay(gameId);
}

async function bootstrap() {
  const { gameId, numsPrice } = readParams();
  await loadFonts();
  const snapshots = await loadSnapshots(gameId);
  const totalFrames =
    INTRO_FRAMES + snapshots.length * FRAMES_PER_STATE + OUTRO_FRAMES;

  const container = document.getElementById("root");
  if (!container) throw new Error("#root not found");

  createRoot(container).render(
    <Replay
      snapshots={snapshots}
      framesPerState={FRAMES_PER_STATE}
      introFrames={INTRO_FRAMES}
      outroFrames={OUTRO_FRAMES}
      totalFrames={totalFrames}
      fps={FPS}
      numsPrice={numsPrice}
    />,
  );

  installHyperframesProtocol({
    fps: FPS,
    durationFrames: totalFrames,
    seekFrame: (frame) => frameStore.setFrame(frame),
  });
}

bootstrap().catch((err) => {
  console.error("[hyperframes] bootstrap failed:", err);
  const container = document.getElementById("root");
  if (container) {
    container.innerText = `Bootstrap failed: ${String(err)}`;
  }
});
