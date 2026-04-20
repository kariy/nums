import { useSyncExternalStore } from "react";

type Listener = () => void;

type Store = {
  frame: number;
  listeners: Set<Listener>;
  setFrame(frame: number): void;
  subscribe(listener: Listener): () => void;
};

export const frameStore: Store = {
  frame: 0,
  listeners: new Set(),
  setFrame(frame) {
    if (frame === frameStore.frame) return;
    frameStore.frame = frame;
    frameStore.listeners.forEach((l) => l());
  },
  subscribe(listener) {
    frameStore.listeners.add(listener);
    return () => frameStore.listeners.delete(listener);
  },
};

export function useFrame(): number {
  return useSyncExternalStore(
    frameStore.subscribe.bind(frameStore),
    () => frameStore.frame,
    () => 0,
  );
}
