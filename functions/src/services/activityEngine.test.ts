import { describe, expect, it } from "vitest";
import { MockCommerceAdapter } from "../integrations/commerce/mock/mockCommerceAdapter";
import {
  ActivityRule,
  NewActivityRule
} from "../domain/activity/activity.types";
import { Campaign, CampaignWithRules } from "../domain/activity/campaign.types";
import { Entitlement } from "../domain/activity/entitlement.types";
import { ActivityLedgerEntry } from "../domain/activity/ledger.types";
import { ActivityProcess } from "../domain/activity/process.types";
import { Wallet, emptyWalletBalances } from "../domain/activity/wallet.types";
import { StoredOrder } from "../domain/order/order.types";
import {
  ActivityProcessRepositoryPort,
  ApplyActivityInput,
  ApplyActivityResult,
  RecordActivityFailureInput
} from "../repositories/activityProcessRepository";
import {
  CampaignRepositoryPort,
  CreateCampaignData
} from "../repositories/campaignRepository";
import { nowIso } from "../utils/dates";
import { ActivityEngineService } from "./activityEngine";

class InMemoryCampaignRepository implements CampaignRepositoryPort {
  readonly campaigns = new Map<string, Campaign>();
  readonly rules = new Map<string, ActivityRule[]>();

  add(campaign: Campaign, rules: ActivityRule[]): void {
    this.campaigns.set(campaign.id, campaign);
    this.rules.set(campaign.id, rules);
  }

  async createCampaign(data: CreateCampaignData): Promise<CampaignWithRules> {
    const campaign: Campaign = {
      id: `CAM_${this.campaigns.size + 1}`,
      ...data,
      status: "draft",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const rules = data.rules.map((rule, index) => ({
      ...rule,
      id: `RULE_${index + 1}`,
      campaignId: campaign.id
    })) as ActivityRule[];
    this.add(campaign, rules);
    return { campaign, rules };
  }

  async getCampaign(campaignId: string): Promise<Campaign | null> {
    return this.campaigns.get(campaignId) ?? null;
  }

  async getCampaignWithRules(campaignId: string): Promise<CampaignWithRules | null> {
    const campaign = await this.getCampaign(campaignId);
    return campaign ? { campaign, rules: this.rules.get(campaignId) ?? [] } : null;
  }

  async listCampaigns(): Promise<CampaignWithRules[]> {
    return Promise.all([...this.campaigns.keys()].map((id) => this.getCampaignWithRules(id) as Promise<CampaignWithRules>));
  }

  async listActivePurchaseCampaigns(): Promise<Campaign[]> {
    return [...this.campaigns.values()].filter(
      (campaign) => campaign.status === "active" && campaign.type === "purchase"
    );
  }

  async listRulesForCampaign(campaignId: string): Promise<ActivityRule[]> {
    return this.rules.get(campaignId) ?? [];
  }

  async activateCampaign(campaignId: string): Promise<Campaign> {
    const campaign = this.campaigns.get(campaignId) as Campaign;
    const active = { ...campaign, status: "active" as const, updatedAt: nowIso() };
    this.campaigns.set(campaignId, active);
    return active;
  }

  async updateRule(ruleId: string, updates: Partial<NewActivityRule>): Promise<ActivityRule> {
    for (const [campaignId, rules] of this.rules.entries()) {
      const index = rules.findIndex((rule) => rule.id === ruleId);
      if (index >= 0) {
        rules[index] = { ...rules[index], ...updates } as ActivityRule;
        this.rules.set(campaignId, rules);
        return rules[index];
      }
    }
    throw new Error("missing rule");
  }
}

class InMemoryActivityProcessRepository implements ActivityProcessRepositoryPort {
  readonly processes = new Map<string, ActivityProcess>();
  readonly entitlements = new Map<string, Entitlement>();
  readonly ledger = new Map<string, ActivityLedgerEntry>();
  readonly wallets = new Map<string, Wallet>();
  failNext = false;

  async applyActivity(input: ApplyActivityInput): Promise<ApplyActivityResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("simulated activity failure");
    }
    const existing = this.processes.get(input.processId);
    if (existing?.status === "processed" || existing?.status === "processing") {
      return {
        process: existing,
        wallet: this.wallets.get(input.userId) as Wallet,
        entitlementIds: existing.entitlementIds,
        duplicated: true
      };
    }

    const timestamp = nowIso();
    const current = this.wallets.get(input.userId);
    const balances = current ? { ...current.balances } : emptyWalletBalances();
    const entitlements: Entitlement[] = [];
    const ledgerEntries: ActivityLedgerEntry[] = [];
    for (const grant of input.grants) {
      balances[grant.type] += grant.quantity;
      entitlements.push({
        id: grant.entitlementId,
        userId: input.userId,
        campaignId: input.campaignId,
        ruleId: grant.ruleId,
        orderId: input.orderId,
        type: grant.type,
        quantity: grant.quantity,
        status: "active",
        createdAt: timestamp
      });
      ledgerEntries.push({
        id: grant.ledgerId,
        userId: input.userId,
        type: grant.type,
        delta: grant.quantity,
        balanceAfter: balances[grant.type],
        reason: "ORDER_ACTIVITY",
        sourceType: "ORDER",
        sourceId: input.orderId,
        campaignId: input.campaignId,
        ruleId: grant.ruleId,
        createdAt: timestamp
      });
    }

    const wallet: Wallet = { userId: input.userId, balances, updatedAt: timestamp };
    const process: ActivityProcess = {
      id: input.processId,
      orderId: input.orderId,
      userId: input.userId,
      campaignId: input.campaignId,
      status: "processed",
      processedAt: timestamp,
      entitlementIds: entitlements.map((entitlement) => entitlement.id),
      errorCode: null,
      error: null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.wallets.set(input.userId, wallet);
    this.processes.set(input.processId, process);
    entitlements.forEach((entitlement) => this.entitlements.set(entitlement.id, entitlement));
    ledgerEntries.forEach((entry) => this.ledger.set(entry.id, entry));
    return {
      process,
      wallet,
      entitlementIds: process.entitlementIds,
      duplicated: false
    };
  }

  async recordFailure(input: RecordActivityFailureInput): Promise<ActivityProcess> {
    const process: ActivityProcess = {
      id: input.processId,
      orderId: input.orderId,
      userId: input.userId,
      campaignId: input.campaignId,
      status: "failed",
      processedAt: null,
      entitlementIds: [],
      errorCode: input.error.code,
      error: input.error,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.processes.set(input.processId, process);
    return process;
  }

  async getProcess(processId: string): Promise<ActivityProcess | null> {
    return this.processes.get(processId) ?? null;
  }

  async listForOrder(orderId: string): Promise<ActivityProcess[]> {
    return [...this.processes.values()].filter((process) => process.orderId === orderId);
  }
}

function buildOrder(
  orderId: string,
  userId: string,
  amount: number,
  paidAt: string,
  invoiceNumber: string | null = "MOCK-INV-001"
): StoredOrder {
  const normalized = new MockCommerceAdapter().normalizeOrder({
    externalOrderId: orderId,
    externalCustomerId: "TEST-CUSTOMER-001",
    status: "paid",
    amount,
    items: [
      {
        productId: "PPA001",
        sku: "PPA+1",
        name: "PPA+1",
        quantity: 1,
        unitPrice: amount
      }
    ],
    invoiceNumber
  });
  return {
    ...normalized,
    id: orderId,
    userId,
    orderedAt: paidAt,
    paidAt,
    sourceCreatedAt: paidAt,
    sourceUpdatedAt: paidAt,
    invoice: {
      ...normalized.invoice,
      issuedAt: invoiceNumber ? paidAt : null
    },
    createdAt: paidAt,
    updatedAt: paidAt
  };
}

function buildFixture() {
  const campaigns = new InMemoryCampaignRepository();
  campaigns.add(
    {
      id: "CAM_001",
      name: "2026 測試消費活動",
      type: "purchase",
      status: "active",
      timezone: "Asia/Taipei",
      startsAt: "2026-09-01T00:00:00+08:00",
      endsAt: "2026-12-31T23:59:59+08:00",
      createdAt: "2026-09-01T00:00:00+08:00",
      updatedAt: "2026-09-01T00:00:00+08:00"
    },
    [
      {
        id: "RULE_SLOT_001",
        campaignId: "CAM_001",
        type: "ORDER_TOTAL_MULTIPLE",
        entitlementType: "SLOT_SPIN",
        thresholdAmount: 1000,
        grantQuantity: 1,
        enabled: true
      },
      {
        id: "RULE_INVOICE_001",
        campaignId: "CAM_001",
        type: "VALID_INVOICE",
        entitlementType: "INVOICE_DRAW",
        grantQuantity: 1,
        enabled: true
      }
    ]
  );
  const activityRepository = new InMemoryActivityProcessRepository();
  return {
    engine: new ActivityEngineService({
      campaignRepository: campaigns,
      activityProcessRepository: activityRepository
    }),
    activityRepository
  };
}

describe("Phase 2A Activity Engine", () => {
  it("grants SLOT_SPIN +3 and INVOICE_DRAW +1 for a paid invoice order", async () => {
    const fixture = buildFixture();
    const result = await fixture.engine.processOrder(
      buildOrder("ORD_001", "USR_001", 3380, "2026-09-04T10:00:00+08:00")
    );

    expect(result.success).toBe(true);
    expect(result.processedCampaigns[0].wallet.balances).toEqual({
      SLOT_SPIN: 3,
      INVOICE_DRAW: 1,
      POINTS: 0
    });
    expect(fixture.activityRepository.entitlements.size).toBe(2);
    expect(fixture.activityRepository.ledger.size).toBe(2);
  });

  it("grants no SLOT_SPIN for an order below the threshold", async () => {
    const fixture = buildFixture();
    const result = await fixture.engine.processOrder(
      buildOrder("ORD_002", "USR_002", 999, "2026-09-04T10:00:00+08:00", null)
    );

    expect(result.processedCampaigns[0].wallet.balances).toEqual({
      SLOT_SPIN: 0,
      INVOICE_DRAW: 0,
      POINTS: 0
    });
    expect(fixture.activityRepository.entitlements.size).toBe(0);
    expect(fixture.activityRepository.ledger.size).toBe(0);
  });

  it("grants SLOT_SPIN +2 for a $2,000 order without invoice qualification", async () => {
    const fixture = buildFixture();
    const result = await fixture.engine.processOrder(
      buildOrder("ORD_003", "USR_003", 2000, "2026-09-04T10:00:00+08:00", null)
    );

    expect(result.processedCampaigns[0].wallet.balances).toEqual({
      SLOT_SPIN: 2,
      INVOICE_DRAW: 0,
      POINTS: 0
    });
    expect(fixture.activityRepository.entitlements.size).toBe(1);
  });

  it("ignores pending orders", async () => {
    const fixture = buildFixture();
    const order = buildOrder("ORD_004", "USR_004", 3380, "2026-09-04T10:00:00+08:00");
    const pending = { ...order, status: "pending" as const, paidAt: null };
    const result = await fixture.engine.processOrder(pending);

    expect(result).toMatchObject({ success: true, ignored: true, processedCampaigns: [] });
    expect(fixture.activityRepository.wallets.size).toBe(0);
  });

  it("is idempotent for the same order and campaign", async () => {
    const fixture = buildFixture();
    const order = buildOrder("ORD_005", "USR_005", 3380, "2026-09-04T10:00:00+08:00");
    const first = await fixture.engine.processOrder(order);
    const second = await fixture.engine.processOrder(order);

    expect(first.processedCampaigns[0].duplicated).toBe(false);
    expect(second.processedCampaigns[0].duplicated).toBe(true);
    expect(fixture.activityRepository.wallets.get("USR_005")?.balances).toEqual({
      SLOT_SPIN: 3,
      INVOICE_DRAW: 1,
      POINTS: 0
    });
    expect(fixture.activityRepository.entitlements.size).toBe(2);
    expect(fixture.activityRepository.ledger.size).toBe(2);
  });

  it("accumulates grants from two orders", async () => {
    const fixture = buildFixture();
    await fixture.engine.processOrder(
      buildOrder("ORD_006", "USR_006", 3380, "2026-09-04T10:00:00+08:00")
    );
    const result = await fixture.engine.processOrder(
      buildOrder("ORD_007", "USR_006", 2000, "2026-09-05T10:00:00+08:00", null)
    );

    expect(result.processedCampaigns[0].wallet.balances.SLOT_SPIN).toBe(5);
    expect(result.processedCampaigns[0].wallet.balances.INVOICE_DRAW).toBe(1);
  });

  it("does not grant an order paid outside the campaign window", async () => {
    const fixture = buildFixture();
    const result = await fixture.engine.processOrder(
      buildOrder("ORD_008", "USR_008", 3380, "2027-01-01T00:00:00+08:00")
    );

    expect(result).toMatchObject({ success: true, ignored: false, processedCampaigns: [] });
    expect(fixture.activityRepository.wallets.size).toBe(0);
  });

  it("records a failed Activity Process and can reprocess it idempotently", async () => {
    const fixture = buildFixture();
    const order = buildOrder("ORD_009", "USR_009", 3380, "2026-09-04T10:00:00+08:00");
    fixture.activityRepository.failNext = true;

    await expect(fixture.engine.processOrder(order)).rejects.toMatchObject({
      code: "ACTIVITY_PROCESSING_FAILED"
    });
    expect(
      fixture.activityRepository.processes.get("ORD_009_CAM_001")
    ).toMatchObject({ status: "failed", error: { code: "ACTIVITY_PROCESSING_FAILED" } });

    const retried = await fixture.engine.processOrder(order);
    expect(retried.processedCampaigns[0].duplicated).toBe(false);
    expect(fixture.activityRepository.wallets.get("USR_009")?.balances.SLOT_SPIN).toBe(3);
  });
});
