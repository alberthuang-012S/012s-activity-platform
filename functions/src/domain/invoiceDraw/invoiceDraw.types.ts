export const INVOICE_DRAW_TIMEZONE = "Asia/Taipei" as const;
export const MAX_INVOICE_DRAW_PRIZES = 20;

export type InvoiceDrawCampaignStatus = "draft" | "active" | "paused" | "ended";

export type InvoiceDrawRewardKind = "NONE" | "POINTS" | "MANUAL_PRIZE";

export type InvoiceDrawStockMode = "UNLIMITED" | "LIMITED";

export interface InvoiceDrawPrize {
  id: string;
  campaignId: string;
  code: string;
  displayName: string;
  description: string;
  rewardKind: InvoiceDrawRewardKind;
  points: number;
  weight: number;
  stockMode: InvoiceDrawStockMode;
  totalStock: number | null;
  enabled: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDrawPrizeSnapshot {
  prizeId: string;
  code: string;
  displayName: string;
  description: string;
  rewardKind: InvoiceDrawRewardKind;
  points: number;
  weight: number;
  stockMode: InvoiceDrawStockMode;
  totalStock: number | null;
  enabled: boolean;
  displayOrder: number;
}

export interface InvoiceDrawCampaign {
  id: string;
  name: string;
  status: InvoiceDrawCampaignStatus;
  timezone: typeof INVOICE_DRAW_TIMEZONE;
  startsAt: string;
  endsAt: string;
  configVersion: number;
  prizePoolSnapshot: InvoiceDrawPrizeSnapshot[];
  poolFingerprint: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDrawPrizeInventory {
  prizeId: string;
  campaignId: string;
  totalStock: number;
  remainingStock: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDrawBalances {
  INVOICE_DRAW: number;
  POINTS: number;
}

export interface InvoiceDrawResultPrize {
  prizeId: string;
  code: string;
  displayName: string;
  rewardKind: InvoiceDrawRewardKind;
  points: number;
  stockMode: InvoiceDrawStockMode;
}

export interface InvoiceDrawResult {
  id: string;
  drawId: string;
  userId: string;
  campaignId: string;
  campaignConfigVersion: number;
  poolFingerprint: string;
  idempotencyKeyHash: string;
  entropyHash: string;
  prize: InvoiceDrawResultPrize;
  won: boolean;
  claimId: string | null;
  balances: InvoiceDrawBalances;
  createdAt: string;
}

export type PrizeClaimStatus = "pending" | "fulfilled";

export interface PrizeClaim {
  id: string;
  userId: string;
  drawId: string;
  campaignId: string;
  prizeId: string;
  prizeCode: string;
  prizeDisplayName: string;
  status: PrizeClaimStatus;
  createdAt: string;
  updatedAt: string;
  fulfilledAt: string | null;
  fulfillmentNote: string | null;
}

export interface InvoiceDrawCampaignDetail {
  campaign: InvoiceDrawCampaign;
  prizes: InvoiceDrawPrize[];
  inventories: InvoiceDrawPrizeInventory[];
}

export interface InvoiceDrawStatusResponse {
  campaign: {
    id: string;
    name: string;
    status: InvoiceDrawCampaignStatus;
    startsAt: string;
    endsAt: string;
  } | null;
  balances: InvoiceDrawBalances;
  canDraw: boolean;
}

export interface InvoiceDrawResponse {
  drawId: string;
  campaignId: string;
  prize: InvoiceDrawResultPrize;
  won: boolean;
  claim: { id: string; status: PrizeClaimStatus } | null;
  balances: InvoiceDrawBalances;
  createdAt: string;
}
