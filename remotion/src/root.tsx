import type { CalculateMetadataFunction } from "remotion";
import { Composition } from "remotion";
import { z } from "zod";
import { Replay } from "./replay";
import { fetchGameReplay } from "./data/torii";
import type { GameSnapshot } from "./types";
import "./styles.css";

const FPS = 120;
const FRAMES_PER_STATE = 120;
const INTRO_FRAMES = FPS * 5;
const OUTRO_FRAMES = FPS * 5;
const DEFAULT_NUMS_PRICE = 0.01138;
const DEFAULT_GAME_ID = 1;

const replaySchema = z.object({
  snapshots: z.custom<GameSnapshot[]>(),
  framesPerState: z.number(),
  introFrames: z.number(),
  outroFrames: z.number(),
  gameId: z.number(),
  numsPrice: z.number(),
});

type ReplayProps = z.infer<typeof replaySchema>;

const calculateMetadata: CalculateMetadataFunction<ReplayProps> = async ({
  props,
}) => {
  const { gameId } = props;

  if (!gameId) {
    throw new Error("gameId is required");
  }

  const snapshots = await fetchGameReplay(gameId);
  console.log(`Loaded ${snapshots.length} snapshots for game ${gameId}`);

  return {
    props: {
      ...props,
      snapshots,
      framesPerState: FRAMES_PER_STATE,
      introFrames: INTRO_FRAMES,
      outroFrames: OUTRO_FRAMES,
    },
    durationInFrames:
      INTRO_FRAMES + snapshots.length * FRAMES_PER_STATE + OUTRO_FRAMES,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="replay"
      component={Replay as React.ComponentType<ReplayProps>}
      schema={replaySchema}
      durationInFrames={INTRO_FRAMES + FRAMES_PER_STATE + OUTRO_FRAMES}
      fps={FPS}
      width={376}
      height={596}
      defaultProps={{
        snapshots: [],
        framesPerState: FRAMES_PER_STATE,
        introFrames: INTRO_FRAMES,
        outroFrames: OUTRO_FRAMES,
        gameId: DEFAULT_GAME_ID,
        numsPrice: DEFAULT_NUMS_PRICE,
      }}
      calculateMetadata={calculateMetadata}
    />
  );
};
