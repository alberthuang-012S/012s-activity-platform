import { ActivityBalanceType } from "./activity.types";

export type EntitlementStatus = "active" | "used" | "revoked" | "expired";

export interface Entitlement {
  id: string;
  userId: string;
  campaignId: string;
  ruleId: string;
  orderId: string;
  type: ActivityBalanceType;
  quantity: number;
  status: EntitlementStatus;
  createdAt: string;
}
