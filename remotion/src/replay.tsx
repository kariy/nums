import { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  getRemotionEnvironment,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { GameScene } from "@/components/scenes/game";
import { GameOver } from "@/components/containers/game-over";
import { WelcomeScene } from "@/components/scenes/welcome";
import type {
  SlotProps,
  PowerUpProps,
  StageState,
} from "@/components/elements";
import { Verifier } from "@/helpers/verifier";
import { Power } from "@/types/power";
import { Trap } from "@/types/trap";
import { Game } from "@/models/game";
import {
  DEFAULT_DRAW_STAGE,
  DEFAULT_MAX_DRAW,
  DEFAULT_POWER_COUNT,
} from "@/constants";
import { useFonts } from "./fonts";
import type { GameSnapshot } from "./types";

interface ReplayProps {
  snapshots: GameSnapshot[];
  framesPerState: number;
  introFrames: number;
  outroFrames: number;
  gameId: number | null;
  numsPrice: number;
}

type SfxEvent = {
  frame: number;
  sound: string;
};

const TRAP_SOUNDS: Record<number, string> = {
  1: "sounds/bomb.wav",
  2: "sounds/esm_positive.wav",
  3: "sounds/magnet.wav",
  4: "sounds/ufo.wav",
  5: "sounds/windy.wav",
};

function snapshotToGame(s: GameSnapshot): Game {
  return new Game(
    s.id,
    false,
    s.multiplier,
    s.level,
    s.slots.length,
    1,
    999,
    s.number,
    s.next_number,
    s.selectable_powers.map((p) => Power.from(p)),
    s.selected_powers.map((p) => Power.from(p)),
    s.enabled_powers,
    s.disabled_traps,
    s.reward,
    s.over,
    0,
    s.traps.map((t) => Trap.from(t)),
    [...s.slots],
    0n,
    0n,
  );
}

function computeSceneProps(game: Game) {
  let powerIndex = 0;
  const stages: StageState[] = Array.from(
    { length: game.slot_count },
    (_, index) => {
      const stageLevel = index + 1;
      const isCompleted = stageLevel <= game.level;
      const hasGem =
        stageLevel % DEFAULT_DRAW_STAGE === 0 && stageLevel <= DEFAULT_MAX_DRAW;
      const hasCrown = stageLevel === game.slot_count;

      let isUnlocked = isCompleted;
      if (hasGem) {
        isUnlocked = isCompleted && !!game.selected_powers[powerIndex];
        powerIndex++;
      }

      return {
        completed: isCompleted,
        breakeven: false,
        gem: hasGem,
        crown: hasCrown,
        unlocked: isUnlocked,
      };
    },
  );

  const enabledPowers = [
    ...game.enabled_powers,
    ...Array(
      Math.max(0, DEFAULT_POWER_COUNT - game.enabled_powers.length),
    ).fill(false),
  ];

  const isOver = Verifier.isOver(
    game.number,
    game.level,
    game.slot_count,
    game.slots,
  );

  const powers: PowerUpProps[] = Array.from(
    { length: DEFAULT_POWER_COUNT },
    (_, index) => {
      const power = game.selected_powers[index];
      if (power && !power.isNone()) {
        return {
          power,
          status: enabledPowers[index] ? undefined : ("used" as const),
          highlighted: isOver,
          disabled: true,
        };
      }
      return {
        power: undefined,
        status: undefined,
        highlighted: false,
        disabled: true,
      };
    },
  );

  const slots: SlotProps[] = game.slots.map((slot, index) => ({
    value: slot,
    highlight: game.over > 0,
    trap: game.getTrap(index),
    inactive: game.isInactive(index),
    disabled: true,
  }));

  return { stages, powers, slots };
}

function computeSfxEvents(
  snapshots: GameSnapshot[],
  framesPerState: number,
): SfxEvent[] {
  const events: SfxEvent[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const frame = i * framesPerState;

    if (curr.number !== prev.number) {
      events.push({ frame, sound: "sounds/slots.wav" });
    }

    if (curr.level > prev.level) {
      events.push({ frame, sound: "sounds/place.wav" });
    }

    const trapIdx = curr.disabled_traps.findIndex(
      (d, idx) => d && !prev.disabled_traps[idx],
    );
    if (trapIdx !== -1) {
      const sound = TRAP_SOUNDS[curr.traps[trapIdx]] || "sounds/click.wav";
      events.push({ frame: frame + 10, sound });
    }

    if (curr.selected_powers.length > prev.selected_powers.length) {
      events.push({ frame, sound: "sounds/power.wav" });
    }

    const powerUsed = curr.enabled_powers.some(
      (e, idx) => !e && prev.enabled_powers[idx],
    );
    if (powerUsed) {
      events.push({ frame, sound: "sounds/reroll.wav" });
    }

    if (curr.over > 0 && prev.over === 0) {
      events.push({ frame, sound: "sounds/esm_negative.wav" });
    }
  }

  return events;
}

export const Replay: React.FC<ReplayProps> = ({
  snapshots,
  framesPerState,
  introFrames,
  outroFrames,
  numsPrice,
}) => {
  useFonts();

  const frame = useCurrentFrame();
  const gameFrame = Math.max(0, frame - introFrames);
  const totalGameFrames = snapshots.length * framesPerState;
  const totalFrames = introFrames + totalGameFrames + outroFrames;

  const isIntro = frame < introFrames;
  const isOutro = gameFrame >= totalGameFrames;

  const stateIndex = Math.min(
    Math.floor(gameFrame / framesPerState),
    snapshots.length - 1,
  );

  const snapshot = snapshots[stateIndex];
  const game = snapshotToGame(snapshot);
  const { stages, powers, slots } = computeSceneProps(game);

  const { isRendering } = getRemotionEnvironment();

  const sfxEvents = useMemo(
    () =>
      computeSfxEvents(snapshots, framesPerState).map((evt) => ({
        ...evt,
        frame: evt.frame + introFrames,
      })),
    [snapshots, framesPerState, introFrames],
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "rgba(89, 31, 255, 1)",
      }}
    >
      <Audio src={staticFile("musics/nums_game_theme.mp3")} volume={0.3} loop />

      {sfxEvents.map((evt, i) => (
        <Sequence
          key={i}
          from={evt.frame}
          durationInFrames={totalFrames - evt.frame}
        >
          <Audio src={staticFile(evt.sound)} volume={0.7} />
        </Sequence>
      ))}

      <img
        src={staticFile("assets/tunnel-background.svg")}
        alt="Background"
        className="absolute inset-0 w-full h-full object-cover"
      />

      <div
        className="relative w-full h-full flex flex-col items-center justify-center"
        style={{
          background:
            "linear-gradient(180deg, rgba(0, 0, 0, 0.32) 0%, rgba(0, 0, 0, 0.12) 100%)",
        }}
      >
        <MotionConfig reducedMotion={isRendering ? "always" : "never"}>
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
    </AbsoluteFill>
  );
};
