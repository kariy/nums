import type { GameSnapshot } from "./types";

export type AudioCue = {
  id: string;
  src: string;
  start: number;
  end: number;
  volume?: number;
};

const TRAP_SOUNDS: Record<number, string> = {
  1: "sounds/bomb.wav",
  2: "sounds/esm_positive.wav",
  3: "sounds/magnet.wav",
  4: "sounds/ufo.wav",
  5: "sounds/windy.wav",
};

type SfxEvent = {
  frame: number;
  sound: string;
};

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

export function buildAudioTimeline(args: {
  snapshots: GameSnapshot[];
  framesPerState: number;
  introFrames: number;
  fps: number;
  totalFrames: number;
}): AudioCue[] {
  const { snapshots, framesPerState, introFrames, fps, totalFrames } = args;
  const totalDuration = totalFrames / fps;
  const sfxDuration = 2;

  const cues: AudioCue[] = [
    {
      id: "bgm-main",
      src: "musics/nums_game_theme.mp3",
      start: 0,
      end: totalDuration,
      volume: 0.3,
    },
  ];

  const events = computeSfxEvents(snapshots, framesPerState);
  events.forEach((evt, index) => {
    const start = (evt.frame + introFrames) / fps;
    const end = Math.min(start + sfxDuration, totalDuration);
    cues.push({
      id: `sfx-${index}-${evt.sound.replace(/[^a-z0-9]/gi, "_")}`,
      src: evt.sound,
      start,
      end,
      volume: 0.7,
    });
  });

  return cues;
}
