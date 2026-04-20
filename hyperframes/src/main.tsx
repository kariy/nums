import { createRoot } from "react-dom/client";
import { Replay } from "./replay";
import { POC_SNAPSHOTS } from "./fixtures";
import { frameStore } from "./frame-store";
import { installHyperframesProtocol } from "./hf-protocol";
import "./styles.css";

const FPS = 120;
const FRAMES_PER_STATE = 40;
const INTRO_FRAMES = 60;
const OUTRO_FRAMES = 60;
const SNAPSHOTS = POC_SNAPSHOTS;
const TOTAL_FRAMES =
  INTRO_FRAMES + SNAPSHOTS.length * FRAMES_PER_STATE + OUTRO_FRAMES;

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <Replay
    snapshots={SNAPSHOTS}
    framesPerState={FRAMES_PER_STATE}
    introFrames={INTRO_FRAMES}
    outroFrames={OUTRO_FRAMES}
    numsPrice={0.01138}
  />,
);

installHyperframesProtocol({
  fps: FPS,
  durationFrames: TOTAL_FRAMES,
  seekFrame: (frame) => frameStore.setFrame(frame),
});
