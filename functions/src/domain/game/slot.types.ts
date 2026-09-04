import type { SlotRewardType } from "./slotGameConfig";

export const SLOT_SYMBOL_IDS = [
  "nne",
  "nap",
  "ppa",
  "012s",
  "plus1",
  "gift"
] as const;

export type SlotSymbolId = (typeof SLOT_SYMBOL_IDS)[number];

export interface SlotReward {
  type: SlotRewardType;
  points: number;
}

export interface SlotBalances {
  SLOT_SPIN: number;
  POINTS: number;
}

export interface GameResult {
  id: string;
  spinId: string;
  userId: string;
  idempotencyKeyHash: string;
  date: string;
  result: SlotSymbolId[];
  reward: SlotReward;
  dailyMissionBonus: number;
  balances: SlotBalances;
  createdAt: string;
}

export interface GameDailyState {
  id: string;
  userId: string;
  date: string;
  firstSpinCompleted: boolean;
  createdAt: string;
}

export interface SlotSpinResponse {
  spinId: string;
  result: SlotSymbolId[];
  reward: SlotReward;
  dailyMissionBonus: number;
  balances: SlotBalances;
}
