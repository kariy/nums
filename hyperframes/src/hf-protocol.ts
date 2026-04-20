import type { HfProtocol } from "@hyperframes/engine";

declare global {
  interface Window {
    __hf?: HfProtocol;
    __hf_ready?: boolean;
  }
}

type InstallOptions = {
  fps: number;
  durationFrames: number;
  seekFrame: (frame: number) => void;
};

export function installHyperframesProtocol(opts: InstallOptions): void {
  const durationSeconds = opts.durationFrames / opts.fps;

  const handle: HfProtocol = {
    duration: durationSeconds,
    seek(time) {
      const frame = Math.max(
        0,
        Math.min(opts.durationFrames - 1, Math.round(time * opts.fps)),
      );
      opts.seekFrame(frame);
    },
  };

  window.__hf = handle;
  window.__hf_ready = true;
}
