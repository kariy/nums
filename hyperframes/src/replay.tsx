import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { GameScene } from "@/components/scenes/game";
import { WelcomeScene } from "@/components/scenes/welcome";
import { GameOver } from "@/components/containers/game-over";
import { useFrame } from "./frame-store";
import { snapshotToGame, computeSceneProps } from "./scene-props";
import type { GameSnapshot } from "./types";

export type ReplayProps = {
  snapshots: GameSnapshot[];
  framesPerState: number;
  introFrames: number;
  outroFrames: number;
  numsPrice: number;
};

export function Replay({
  snapshots,
  framesPerState,
  introFrames,
  outroFrames,
  numsPrice,
}: ReplayProps) {
  const frame = useFrame();
  const gameFrame = Math.max(0, frame - introFrames);
  const totalGameFrames = snapshots.length * framesPerState;

  const isIntro = frame < introFrames;
  const isOutro = gameFrame >= totalGameFrames;

  const stateIndex = Math.min(
    Math.floor(gameFrame / framesPerState),
    snapshots.length - 1,
  );

  const snapshot = snapshots[stateIndex];
  const game = snapshotToGame(snapshot);
  const { stages, powers, slots } = computeSceneProps(game);

  void outroFrames;

  return (
    <div
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
          {isIntro && (
            <WelcomeScene close={() => {}} className="w-full h-full" />
          )}

          {isOutro && (
            <div className="absolute inset-0 z-50 flex-1 bg-black-700 backdrop-blur-[4px]">
              <div className="absolute inset-0 z-50 flex items-center justify-center m-3">
                <GameOver
                  stages={{ states: stages }}
                  payout={snapshot.reward}
                  value={snapshot.reward * numsPrice}
                  score={game.level}
                  newGameId={0}
                  newGameCount={0}
                  onClose={() => {}}
                  onPurchase={() => {}}
                  onClaim={() => {}}
                />
              </div>
            </div>
          )}

          {!isIntro && !isOutro && (
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
          )}
        </MotionConfig>
      </div>
    </div>
  );
}
