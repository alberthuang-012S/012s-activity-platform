import { ActivityBalanceType } from "./activity.types";

export type ActivityLedgerReason =
  | "ORDER_ACTIVITY"
  | "SLOT_PLAY"
  | "SLOT_REWARD"
  | "DAILY_MISSION"
  | "INVOICE_DRAW_PLAY"
  | "INVOICE_DRAW_REWARD";
export type ActivityLedgerSourceType = "ORDER" | "GAME_RESULT" | "INVOICE_DRAW_RESULT";

export interface ActivityLedgerEntry {
  id: string;
  userId: string;
  type: ActivityBalanceType;
  delta: number;
  balanceAfter: number;
  reason: ActivityLedgerReason;
  sourceType: ActivityLedgerSourceType;
  sourceId: string;
  campaignId: string | null;
  ruleId: string | null;
  createdAt: string;
}
