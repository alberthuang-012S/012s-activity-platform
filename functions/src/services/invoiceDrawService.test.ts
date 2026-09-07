import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApplicationError } from "../domain/order/order.errors";
import { ActivityLedgerEntry } from "../domain/activity/ledger.types";
import { emptyWalletBalances, WalletBalances } from "../domain/activity/wallet.types";
import {
  InvoiceDrawCampaign,
  InvoiceDrawPrizeInventory,
  InvoiceDrawPrizeSnapshot,
  InvoiceDrawResult,
  PrizeClaim
} from "../domain/invoiceDraw/invoiceDraw.types";
import {
  ExecuteInvoiceDrawInput,
  ExecuteInvoiceDrawResult,
  InvoiceDrawResultListFilter,
  InvoiceDrawResultRepositoryPort
} from "../repositories/invoiceDrawResultRepository";
import {
  PrizeClaimListFilter,
  PrizeClaimRepositoryPort
} from "../repositories/prizeClaimRepository";
import { selectInvoiceDrawPrize } from "../domain/invoiceDraw/invoiceDrawRandom";
import { InvoiceDrawService } from "./invoiceDrawService";

const actorA = { userId: "USR_DRAW_A", sessionId: "SES_DRAW_A" };
const actorB = { userId: "USR_DRAW_B", sessionId: "SES_DRAW_B" };
const keyA = "11111111-1111-4111-8111-111111111111";
const keyB = "22222222-2222-4222-8222-222222222222";

function snapshot(overrides: Partial<InvoiceDrawPrizeSnapshot> = {}): InvoiceDrawPrizeSnapshot {
  return {
    prizeId: "PRIZE_NONE",
    code: "NONE",
    displayName: "No prize",
    description: "",
    rewardKind: "NONE",
    points: 0,
    weight: 1,
    stockMode: "UNLIMITED",
    totalStock: null,
    enabled: true,
    displayOrder: 0,
    ...overrides
  };
}

function campaign(prizes: InvoiceDrawPrizeSnapshot[]): InvoiceDrawCampaign {
  return {
    id: "IDCAM_DRAW",
    name: "Invoice Draw Test",
    status: "active",
    timezone: "Asia/Taipei",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-12-31T23:59:59.000Z",
    configVersion: 2,
    prizePoolSnapshot: prizes,
    poolFingerprint: "fingerprint",
    activatedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

class InMemoryInvoiceDrawRepository implements InvoiceDrawResultRepositoryPort {
  readonly campaigns = new Map<string, InvoiceDrawCampaign>();
  readonly wallets = new Map<string, WalletBalances>();
  readonly inventories = new Map<string, InvoiceDrawPrizeInventory>();
  readonly results = new Map<string, InvoiceDrawResult>();
  readonly claims = new Map<string, PrizeClaim>();
  readonly ledger: ActivityLedgerEntry[] = [];
  private transactionQueue: Promise<void> = Promise.resolve();

  async getResult(drawId: string): Promise<InvoiceDrawResult | null> {
    return this.results.get(drawId) ?? null;
  }

  async executeDraw(input: ExecuteInvoiceDrawInput): Promise<ExecuteInvoiceDrawResult> {
    const previous = this.transactionQueue;
    let release!: () => void;
    this.transactionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;

    try {
      const existing = this.results.get(input.drawId);
      if (existing) {
        return {
          result: existing,
          claim: existing.claimId ? this.claims.get(existing.claimId) ?? null : null,
          duplicated: true
        };
      }

      const drawCampaign = this.campaigns.get(input.campaignId);
      if (!drawCampaign) throw new ApplicationError("INVOICE_DRAW_CAMPAIGN_NOT_FOUND", "missing campaign");
      const wallet = {
        ...emptyWalletBalances(),
        ...(this.wallets.get(input.userId) ?? {})
      };
      if (wallet.INVOICE_DRAW < 1) {
        throw new ApplicationError("INVOICE_DRAW_EXHAUSTED", "no draw balance");
      }
      const eligible = drawCampaign.prizePoolSnapshot.filter((prize) => {
        if (!prize.enabled || prize.weight <= 0) return false;
        if (prize.stockMode === "UNLIMITED") return true;
        return (this.inventories.get(prize.prizeId)?.remainingStock ?? 0) > 0;
      });
      if (eligible.length === 0) {
        throw new ApplicationError("INVOICE_DRAW_POOL_EXHAUSTED", "empty pool");
      }
      const selected = selectInvoiceDrawPrize(eligible, input.entropySeed);
      wallet.INVOICE_DRAW -= 1;
      if (selected.stockMode === "LIMITED") {
        const inventory = this.inventories.get(selected.prizeId);
        if (!inventory || inventory.remainingStock < 1) {
          throw new ApplicationError("INVOICE_DRAW_POOL_EXHAUSTED", "empty stock");
        }
        this.inventories.set(selected.prizeId, {
          ...inventory,
          remainingStock: inventory.remainingStock - 1,
          updatedAt: input.now
        });
      }
      const rewardPoints = selected.rewardKind === "POINTS" ? selected.points : 0;
      wallet.POINTS += rewardPoints;
      const claimId = selected.rewardKind === "MANUAL_PRIZE" ? `CLAIM_${input.drawId}` : null;
      const claim = claimId ? {
        id: claimId,
        userId: input.userId,
        drawId: input.drawId,
        campaignId: input.campaignId,
        prizeId: selected.prizeId,
        prizeCode: selected.code,
        prizeDisplayName: selected.displayName,
        status: "pending" as const,
        createdAt: input.now,
        updatedAt: input.now,
        fulfilledAt: null,
        fulfillmentNote: null
      } : null;
      const result: InvoiceDrawResult = {
        id: input.drawId,
        drawId: input.drawId,
        userId: input.userId,
        campaignId: input.campaignId,
        campaignConfigVersion: drawCampaign.configVersion,
        poolFingerprint: drawCampaign.poolFingerprint ?? "",
        idempotencyKeyHash: input.idempotencyKeyHash,
        entropyHash: input.entropyHash,
        prize: {
          prizeId: selected.prizeId,
          code: selected.code,
          displayName: selected.displayName,
          rewardKind: selected.rewardKind,
          points: selected.points,
          stockMode: selected.stockMode
        },
        won: selected.rewardKind !== "NONE",
        claimId,
        balances: { INVOICE_DRAW: wallet.INVOICE_DRAW, POINTS: wallet.POINTS },
        createdAt: input.now
      };
      this.wallets.set(input.userId, wallet);
      this.results.set(input.drawId, result);
      if (claim) this.claims.set(claim.id, claim);
      this.ledger.push({
        id: `${input.drawId}:play`, userId: input.userId, type: "INVOICE_DRAW", delta: -1,
        balanceAfter: wallet.INVOICE_DRAW, reason: "INVOICE_DRAW_PLAY", sourceType: "INVOICE_DRAW_RESULT",
        sourceId: input.drawId, campaignId: input.campaignId, ruleId: null, createdAt: input.now
      });
      if (rewardPoints > 0) this.ledger.push({
        id: `${input.drawId}:reward`, userId: input.userId, type: "POINTS", delta: rewardPoints,
        balanceAfter: wallet.POINTS, reason: "INVOICE_DRAW_REWARD", sourceType: "INVOICE_DRAW_RESULT",
        sourceId: input.drawId, campaignId: input.campaignId, ruleId: null, createdAt: input.now
      });
      return { result, claim, duplicated: false };
    } finally {
      release();
    }
  }

  async listResults(filter: InvoiceDrawResultListFilter): Promise<InvoiceDrawResult[]> {
    return [...this.results.values()]
      .filter((result) => !filter.userId || result.userId === filter.userId)
      .filter((result) => !filter.campaignId || result.campaignId === filter.campaignId)
      .slice(0, filter.limit ?? 20);
  }
}

class InMemoryPrizeClaimRepository implements PrizeClaimRepositoryPort {
  constructor(private readonly repository: InMemoryInvoiceDrawRepository) {}

  async getClaim(claimId: string): Promise<PrizeClaim | null> {
    return this.repository.claims.get(claimId) ?? null;
  }

  async listClaims(filter: PrizeClaimListFilter): Promise<PrizeClaim[]> {
    return [...this.repository.claims.values()]
      .filter((claim) => !filter.userId || claim.userId === filter.userId)
      .filter((claim) => !filter.status || claim.status === filter.status);
  }

  async fulfillClaim(claimId: string, note: string | null): Promise<PrizeClaim> {
    const claim = this.repository.claims.get(claimId);
    if (!claim) throw new ApplicationError("PRIZE_CLAIM_NOT_FOUND", "missing claim");
    if (claim.status === "fulfilled") return claim;
    const fulfilled = {
      ...claim,
      status: "fulfilled" as const,
      fulfilledAt: "2026-09-04T10:01:00.000Z",
      fulfillmentNote: note,
      updatedAt: "2026-09-04T10:01:00.000Z"
    };
    this.repository.claims.set(claimId, fulfilled);
    return fulfilled;
  }
}

function createService(repository: InMemoryInvoiceDrawRepository, seed = "entropy-seed") {
  const claimRepository = new InMemoryPrizeClaimRepository(repository);
  let randomCalls = 0;
  const service = new InvoiceDrawService({
    resultRepository: repository,
    claimRepository,
    getAvailableCampaign: async () => ({ id: "IDCAM_DRAW" }),
    clock: () => new Date("2026-09-04T10:00:00.000Z"),
    randomBytes: () => {
      randomCalls += 1;
      return Buffer.from(seed);
    }
  });
  return { service, claimRepository, randomCalls: () => randomCalls };
}

describe("InvoiceDrawService", () => {
  it("spends one INVOICE_DRAW and does not create a zero-point reward ledger for NONE", async () => {
    const repository = new InMemoryInvoiceDrawRepository();
    repository.campaigns.set("IDCAM_DRAW", campaign([snapshot()]));
    repository.wallets.set(actorA.userId, { SLOT_SPIN: 0, INVOICE_DRAW: 1, POINTS: 0 });
    const { service } = createService(repository);

    const response = await service.draw(actorA, keyA);

    expect(response.won).toBe(false);
    expect(response.balances).toEqual({ INVOICE_DRAW: 0, POINTS: 0 });
    expect(repository.results.get(response.drawId)?.entropyHash).toBe(
      createHash("sha256").update(Buffer.from("entropy-seed")).digest("hex")
    );
    expect(repository.wallets.get(actorA.userId)).toMatchObject({ INVOICE_DRAW: 0, POINTS: 0 });
    expect(repository.ledger.map((entry) => [entry.reason, entry.delta])).toEqual([
      ["INVOICE_DRAW_PLAY", -1]
    ]);
  });

  it("adds POINTS and creates a manual prize claim only for the matching reward kind", async () => {
    const repository = new InMemoryInvoiceDrawRepository();
    repository.campaigns.set("IDCAM_DRAW", campaign([
      snapshot({ prizeId: "PRIZE_POINTS", code: "POINTS", rewardKind: "POINTS", points: 25 }),
      snapshot({ prizeId: "PRIZE_MANUAL", code: "MANUAL", rewardKind: "MANUAL_PRIZE", displayName: "Gift", displayOrder: 1 })
    ]));
    repository.wallets.set(actorA.userId, { SLOT_SPIN: 0, INVOICE_DRAW: 2, POINTS: 0 });
    const pointsService = createService(repository, "points-seed").service;
    const pointsResult = await pointsService.draw(actorA, keyA);
    expect(pointsResult.prize.rewardKind).toBe("POINTS");
    expect(pointsResult.balances.POINTS).toBe(25);
    expect(repository.ledger.filter((entry) => entry.reason === "INVOICE_DRAW_REWARD")).toHaveLength(1);

    const manualRepository = new InMemoryInvoiceDrawRepository();
    manualRepository.campaigns.set("IDCAM_DRAW", campaign([
      snapshot({ prizeId: "PRIZE_MANUAL", code: "MANUAL", rewardKind: "MANUAL_PRIZE", displayName: "Gift" })
    ]));
    manualRepository.wallets.set(actorA.userId, { SLOT_SPIN: 0, INVOICE_DRAW: 1, POINTS: 0 });
    const { service: manualService } = createService(manualRepository, "manual-seed");
    const manualResult = await manualService.draw(actorA, keyA);
    expect(manualResult.claim).toMatchObject({ status: "pending" });
    expect(manualRepository.ledger.some((entry) => entry.reason === "INVOICE_DRAW_REWARD")).toBe(false);
    const manualClaimRepository = new InMemoryPrizeClaimRepository(manualRepository);
    const fulfilled = await manualClaimRepository.fulfillClaim(manualResult.claim!.id, "sent");
    const repeated = await manualClaimRepository.fulfillClaim(manualResult.claim!.id, "changed");
    expect(fulfilled.status).toBe("fulfilled");
    expect(repeated).toEqual(fulfilled);
  });

  it("returns the exact same result for a repeated idempotency key", async () => {
    const repository = new InMemoryInvoiceDrawRepository();
    repository.campaigns.set("IDCAM_DRAW", campaign([snapshot({ rewardKind: "POINTS", points: 10, code: "POINTS" })]));
    repository.wallets.set(actorA.userId, { SLOT_SPIN: 0, INVOICE_DRAW: 1, POINTS: 0 });
    const { service, randomCalls } = createService(repository);

    const first = await service.draw(actorA, keyA);
    const second = await service.draw(actorA, keyA);

    expect(second).toEqual(first);
    expect(randomCalls()).toBe(1);
    expect(repository.results.size).toBe(1);
    expect(repository.ledger).toHaveLength(2);
    expect(repository.wallets.get(actorA.userId)).toMatchObject({ INVOICE_DRAW: 0, POINTS: 10 });
  });

  it("allows only one of two concurrent keys to consume the last draw", async () => {
    const repository = new InMemoryInvoiceDrawRepository();
    repository.campaigns.set("IDCAM_DRAW", campaign([snapshot()]));
    repository.wallets.set(actorA.userId, { SLOT_SPIN: 0, INVOICE_DRAW: 1, POINTS: 0 });
    const { service } = createService(repository);

    const settled = await Promise.allSettled([
      service.draw(actorA, keyA),
      service.draw(actorA, keyB)
    ]);
    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((entry) => entry.status === "rejected" && entry.reason?.code === "INVOICE_DRAW_EXHAUSTED")).toHaveLength(1);
    expect(repository.wallets.get(actorA.userId)).toMatchObject({ INVOICE_DRAW: 0 });
    expect(repository.ledger.filter((entry) => entry.reason === "INVOICE_DRAW_PLAY")).toHaveLength(1);
  });

  it("does not consume a draw when the only limited prize is exhausted", async () => {
    const repository = new InMemoryInvoiceDrawRepository();
    const limited = snapshot({
      prizeId: "PRIZE_LIMITED",
      code: "LIMITED",
      rewardKind: "MANUAL_PRIZE",
      stockMode: "LIMITED",
      totalStock: 1
    });
    repository.campaigns.set("IDCAM_DRAW", campaign([limited]));
    repository.inventories.set(limited.prizeId, {
      prizeId: limited.prizeId,
      campaignId: "IDCAM_DRAW",
      totalStock: 1,
      remainingStock: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    });
    repository.wallets.set(actorA.userId, { SLOT_SPIN: 0, INVOICE_DRAW: 1, POINTS: 0 });
    repository.wallets.set(actorB.userId, { SLOT_SPIN: 0, INVOICE_DRAW: 1, POINTS: 0 });
    const { service } = createService(repository);
    const first = await service.draw(actorA, keyA);
    expect(first.claim).toBeTruthy();

    await expect(service.draw(actorB, keyB)).rejects.toMatchObject({ code: "INVOICE_DRAW_POOL_EXHAUSTED" });
    expect(repository.wallets.get(actorB.userId)).toMatchObject({ INVOICE_DRAW: 1 });
    expect(repository.inventories.get(limited.prizeId)).toMatchObject({ remainingStock: 0 });
  });
});
