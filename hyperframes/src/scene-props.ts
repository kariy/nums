import type { SlotProps, PowerUpProps, StageState } from "@/components/elements";
import { Verifier } from "@/helpers/verifier";
import { Power } from "@/types/power";
import { Trap } from "@/types/trap";
import { Game } from "@/models/game";
import {
  DEFAULT_DRAW_STAGE,
  DEFAULT_MAX_DRAW,
  DEFAULT_POWER_COUNT,
} from "@/constants";
import type { GameSnapshot } from "./types";

export function snapshotToGame(s: GameSnapshot): Game {
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

export function computeSceneProps(game: Game) {
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
