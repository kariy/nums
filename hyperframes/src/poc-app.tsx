import { createRoot } from "react-dom/client";
import { useSyncExternalStore } from "react";
import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { GameScene } from "@/components/scenes/game";
import { POC_SNAPSHOTS } from "./fixtures";
import { snapshotToGame, computeSceneProps } from "./scene-props";
import { installHyperframesProtocol } from "./hf-protocol";
import "./styles.css";

const FRAMES_PER_STATE = 40;
const FPS = 120;
const TOTAL_FRAMES = POC_SNAPSHOTS.length * FRAMES_PER_STATE;

type Store = {
  frame: number;
  listeners: Set<() => void>;
  setFrame(frame: number): void;
  subscribe(listener: () => void): () => void;
};

const store: Store = {
  frame: 0,
  listeners: new Set(),
  setFrame(frame) {
    if (frame === store.frame) return;
    store.frame = frame;
    store.listeners.forEach((l) => l());
  },
  subscribe(listener) {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
};

function useFrame(): number {
  return useSyncExternalStore(
    store.subscribe.bind(store),
    () => store.frame,
    () => 0,
  );
}

function App() {
  const frame = useFrame();
  const stateIndex = Math.min(
    Math.floor(frame / FRAMES_PER_STATE),
    POC_SNAPSHOTS.length - 1,
  );
  const snapshot = POC_SNAPSHOTS[stateIndex];
  const game = snapshotToGame(snapshot);
  const { stages, powers, slots } = computeSceneProps(game);

  return (
    <div
      data-composition-id="nums-replay-poc"
      data-fps={FPS}
      data-duration-frames={TOTAL_FRAMES}
      style={{
        width: 376,
        height: 596,
        position: "relative",
        overflow: "hidden",
        background: "rgba(89, 31, 255, 1)",
      }}
    >
      <img
        src="/assets/tunnel-background.svg"
        alt="Background"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(180deg, rgba(0, 0, 0, 0.32) 0%, rgba(0, 0, 0, 0.12) 100%)",
        }}
      >
        <MotionConfig reducedMotion="always">
          <TooltipProvider>
            <GameScene
              game={game}
              multiplier={snapshot.multiplier}
              powers={powers}
              slots={slots}
              stages={stages}
              className="w-full h-full p-4"
            />
          </TooltipProvider>
        </MotionConfig>
      </div>
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(<App />);

installHyperframesProtocol({
  fps: FPS,
  durationFrames: TOTAL_FRAMES,
  seekFrame: (frame) => store.setFrame(frame),
});
