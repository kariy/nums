export interface GameSnapshot {
  id: number;
  number: number;
  next_number: number;
  level: number;
  reward: number;
  multiplier: number;
  slots: number[];
  traps: number[];
  disabled_traps: boolean[];
  selected_powers: number[];
  enabled_powers: boolean[];
  selectable_powers: number[];
  over: number;
}
