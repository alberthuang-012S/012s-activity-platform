export type ActivityBalanceType = "SLOT_SPIN" | "INVOICE_DRAW" | "POINTS";

export const ACTIVITY_BALANCE_TYPES: readonly ActivityBalanceType[] = [
  "SLOT_SPIN",
  "INVOICE_DRAW",
  "POINTS"
];

export type ActivityRuleType = "ORDER_TOTAL_MULTIPLE" | "VALID_INVOICE";

export interface OrderTotalMultipleRule {
  id: string;
  campaignId: string;
  type: "ORDER_TOTAL_MULTIPLE";
  entitlementType: "SLOT_SPIN";
  thresholdAmount: number;
  grantQuantity: number;
  enabled: boolean;
}

export interface ValidInvoiceRule {
  id: string;
  campaignId: string;
  type: "VALID_INVOICE";
  entitlementType: "INVOICE_DRAW";
  grantQuantity: number;
  enabled: boolean;
}

export type ActivityRule = OrderTotalMultipleRule | ValidInvoiceRule;

export type NewActivityRule = Omit<ActivityRule, "id" | "campaignId">;

export type ActivityProcessStatus = "processing" | "processed" | "ignored" | "failed";

export interface ActivityGrant {
  ruleId: string;
  type: ActivityBalanceType;
  quantity: number;
}
