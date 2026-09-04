import type { SlotSymbolId } from "./slot.types";

export type SlotRewardType =
  | "normal"
  | "double"
  | "triple"
  | "brandTriple"
  | "plusTriple"
  | "jackpot";

export interface SlotSymbolConfig {
  id: SlotSymbolId;
  weight: number;
}

export const SLOT_GAME_CONFIG: {
  readonly timezone: "Asia/Taipei";
  readonly dailyMissionBonus: 5;
  readonly symbols: readonly SlotSymbolConfig[];
  readonly rewards: Readonly<Record<SlotRewardType, number>>;
} = {
  timezone: "Asia/Taipei",
  dailyMissionBonus: 5,
  symbols: [
    { id: "nne", weight: 25 },
    { id: "nap", weight: 25 },
    { id: "ppa", weight: 25 },
    { id: "012s", weight: 15 },
    { id: "plus1", weight: 7 },
    { id: "gift", weight: 3 }
  ],
  rewards: {
    normal: 5,
    double: 10,
    triple: 30,
    brandTriple: 50,
    plusTriple: 100,
    jackpot: 300
  }
};
