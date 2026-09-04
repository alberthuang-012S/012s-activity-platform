import { ActivityBalanceType } from "./activity.types";

export type ActivityLedgerReason = "ORDER_ACTIVITY";
export type ActivityLedgerSourceType = "ORDER";

export interface ActivityLedgerEntry {
  id: string;
  userId: string;
  type: ActivityBalanceType;
  delta: number;
  balanceAfter: number;
  reason: ActivityLedgerReason;
  sourceType: ActivityLedgerSourceType;
  sourceId: string;
  campaignId: string;
  ruleId: string;
  createdAt: string;
}
