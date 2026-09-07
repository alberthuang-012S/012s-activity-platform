import { Firestore } from "firebase-admin/firestore";
import { ApplicationError } from "../domain/order/order.errors";
import { ActivityBalanceType } from "../domain/activity/activity.types";
import { ActivityLedgerEntry } from "../domain/activity/ledger.types";
import { emptyWalletBalances, Wallet, WalletBalances } from "../domain/activity/wallet.types";
import { invoiceDrawCampaignIsAvailable } from "../domain/invoiceDraw/invoiceDraw.schema";
import { selectInvoiceDrawPrize } from "../domain/invoiceDraw/invoiceDrawRandom";
import {
  InvoiceDrawCampaign,
  InvoiceDrawResult,
  InvoiceDrawPrizeInventory,
  PrizeClaim
} from "../domain/invoiceDraw/invoiceDraw.types";
import { nowIso } from "../utils/dates";
import { createDeterministicId } from "../utils/ids";

export interface ExecuteInvoiceDrawInput {
  drawId: string;
  userId: string;
  campaignId: string;
  idempotencyKeyHash: string;
  entropyHash: string;
  entropySeed: Uint8Array;
  now: string;
}

export interface ExecuteInvoiceDrawResult {
  result: InvoiceDrawResult;
  claim: PrizeClaim | null;
  duplicated: boolean;
}

export interface InvoiceDrawResultListFilter {
  userId?: string;
  campaignId?: string;
  limit?: number;
}

export interface InvoiceDrawResultRepositoryPort {
  getResult(drawId: string): Promise<InvoiceDrawResult | null>;
  executeDraw(input: ExecuteInvoiceDrawInput): Promise<ExecuteInvoiceDrawResult>;
  listResults(filter: InvoiceDrawResultListFilter): Promise<InvoiceDrawResult[]>;
}

function validBalance(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readWalletBalances(value: unknown): WalletBalances {
  const balances = emptyWalletBalances();
  if (value === undefined || value === null) return balances;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("INVALID_WALLET_BALANCE", "Wallet balances must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  for (const type of Object.keys(balances) as ActivityBalanceType[]) {
    const balance = candidate[type] ?? 0;
    if (!validBalance(balance)) {
      throw new ApplicationError(
        "INVALID_WALLET_BALANCE",
        `Wallet balance ${type} must be a non-negative integer.`
      );
    }
    balances[type] = balance;
  }
  return balances;
}

function safeLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new ApplicationError("INVALID_INVOICE_DRAW_REQUEST", "limit must be a positive integer.");
  }
  return Math.min(limit, 50);
}

export class InvoiceDrawResultRepository implements InvoiceDrawResultRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async getResult(drawId: string): Promise<InvoiceDrawResult | null> {
    const snapshot = await this.db.collection("invoice_draw_results").doc(drawId).get();
    return snapshot.exists ? (snapshot.data() as InvoiceDrawResult) : null;
  }

  async executeDraw(input: ExecuteInvoiceDrawInput): Promise<ExecuteInvoiceDrawResult> {
    const resultReference = this.db.collection("invoice_draw_results").doc(input.drawId);
    const campaignReference = this.db.collection("invoice_draw_campaigns").doc(input.campaignId);
    const walletReference = this.db.collection("wallets").doc(input.userId);

    return this.db.runTransaction(async (transaction) => {
      const existingResultSnapshot = await transaction.get(resultReference);
      if (existingResultSnapshot.exists) {
        const result = existingResultSnapshot.data() as InvoiceDrawResult;
        const claim = result.claimId
          ? await this.getClaimForTransaction(transaction, result.claimId)
          : null;
        return { result, claim, duplicated: true };
      }

      const campaignSnapshot = await transaction.get(campaignReference);
      const walletSnapshot = await transaction.get(walletReference);
      if (!campaignSnapshot.exists) {
        throw new ApplicationError(
          "INVOICE_DRAW_CAMPAIGN_NOT_FOUND",
          "Invoice draw campaign could not be resolved."
        );
      }
      const campaign = campaignSnapshot.data() as InvoiceDrawCampaign;
      if (!invoiceDrawCampaignIsAvailable(campaign, input.now)) {
        throw new ApplicationError(
          "INVOICE_DRAW_CAMPAIGN_NOT_AVAILABLE",
          "Invoice draw campaign is not available."
        );
      }
      if (!campaign.poolFingerprint || !Array.isArray(campaign.prizePoolSnapshot)) {
        throw new ApplicationError(
          "INVALID_INVOICE_DRAW_CAMPAIGN",
          "Invoice draw campaign has no immutable prize pool snapshot."
        );
      }

      const inventorySnapshots = new Map<string, FirebaseFirestore.DocumentSnapshot>();
      for (const prize of campaign.prizePoolSnapshot) {
        if (prize.stockMode === "LIMITED") {
          const inventoryReference = this.db
            .collection("invoice_draw_prize_inventory")
            .doc(prize.prizeId);
          inventorySnapshots.set(prize.prizeId, await transaction.get(inventoryReference));
        }
      }

      const balances = readWalletBalances(walletSnapshot.data()?.balances);
      if (balances.INVOICE_DRAW < 1) {
        throw new ApplicationError(
          "INVOICE_DRAW_EXHAUSTED",
          "No INVOICE_DRAW entitlement is available."
        );
      }

      const eligiblePrizes = campaign.prizePoolSnapshot.filter((prize) => {
        if (!prize.enabled || prize.weight <= 0) return false;
        if (prize.stockMode === "UNLIMITED") return true;
        const inventory = inventorySnapshots.get(prize.prizeId);
        if (!inventory?.exists) return false;
        const data = inventory.data() as InvoiceDrawPrizeInventory;
        return Number.isSafeInteger(data.remainingStock) && data.remainingStock > 0;
      });
      if (eligiblePrizes.length === 0) {
        throw new ApplicationError(
          "INVOICE_DRAW_POOL_EXHAUSTED",
          "No eligible invoice draw prize is available."
        );
      }

      const selectedPrize = selectInvoiceDrawPrize(eligiblePrizes, input.entropySeed);
      balances.INVOICE_DRAW -= 1;
      const invoiceDrawBalanceAfter = balances.INVOICE_DRAW;
      let inventoryUpdate: { reference: FirebaseFirestore.DocumentReference; value: InvoiceDrawPrizeInventory } | null = null;
      if (selectedPrize.stockMode === "LIMITED") {
        const inventorySnapshot = inventorySnapshots.get(selectedPrize.prizeId);
        if (!inventorySnapshot?.exists) {
          throw new ApplicationError("INVOICE_DRAW_POOL_EXHAUSTED", "Prize inventory is exhausted.");
        }
        const inventory = inventorySnapshot.data() as InvoiceDrawPrizeInventory;
        if (inventory.remainingStock <= 0) {
          throw new ApplicationError("INVOICE_DRAW_POOL_EXHAUSTED", "Prize inventory is exhausted.");
        }
        inventoryUpdate = {
          reference: inventorySnapshot.ref,
          value: {
            ...inventory,
            remainingStock: inventory.remainingStock - 1,
            updatedAt: input.now
          }
        };
      }

      const rewardPoints = selectedPrize.rewardKind === "POINTS" ? selectedPrize.points : 0;
      balances.POINTS += rewardPoints;
      const pointsBalanceAfter = balances.POINTS;
      const claimId = selectedPrize.rewardKind === "MANUAL_PRIZE"
        ? createDeterministicId("CLAIM", input.drawId)
        : null;
      const claim: PrizeClaim | null = claimId
        ? {
            id: claimId,
            userId: input.userId,
            drawId: input.drawId,
            campaignId: input.campaignId,
            prizeId: selectedPrize.prizeId,
            prizeCode: selectedPrize.code,
            prizeDisplayName: selectedPrize.displayName,
            status: "pending",
            createdAt: input.now,
            updatedAt: input.now,
            fulfilledAt: null,
            fulfillmentNote: null
          }
        : null;
      const result: InvoiceDrawResult = {
        id: input.drawId,
        drawId: input.drawId,
        userId: input.userId,
        campaignId: input.campaignId,
        campaignConfigVersion: campaign.configVersion,
        poolFingerprint: campaign.poolFingerprint,
        idempotencyKeyHash: input.idempotencyKeyHash,
        entropyHash: input.entropyHash,
        prize: {
          prizeId: selectedPrize.prizeId,
          code: selectedPrize.code,
          displayName: selectedPrize.displayName,
          rewardKind: selectedPrize.rewardKind,
          points: selectedPrize.points,
          stockMode: selectedPrize.stockMode
        },
        won: selectedPrize.rewardKind !== "NONE",
        claimId,
        balances: {
          INVOICE_DRAW: invoiceDrawBalanceAfter,
          POINTS: pointsBalanceAfter
        },
        createdAt: input.now
      };
      const wallet: Wallet = {
        userId: input.userId,
        balances,
        updatedAt: input.now
      };
      const playLedger: ActivityLedgerEntry = {
        id: createDeterministicId("LEDGER", `${input.drawId}:INVOICE_DRAW_PLAY`),
        userId: input.userId,
        type: "INVOICE_DRAW",
        delta: -1,
        balanceAfter: invoiceDrawBalanceAfter,
        reason: "INVOICE_DRAW_PLAY",
        sourceType: "INVOICE_DRAW_RESULT",
        sourceId: input.drawId,
        campaignId: input.campaignId,
        ruleId: null,
        createdAt: input.now
      };

      transaction.set(walletReference, wallet);
      if (inventoryUpdate) transaction.set(inventoryUpdate.reference, inventoryUpdate.value);
      transaction.create(this.db.collection("activity_ledger").doc(playLedger.id), playLedger);
      if (rewardPoints > 0) {
        const rewardLedger: ActivityLedgerEntry = {
          id: createDeterministicId("LEDGER", `${input.drawId}:INVOICE_DRAW_REWARD`),
          userId: input.userId,
          type: "POINTS",
          delta: rewardPoints,
          balanceAfter: pointsBalanceAfter,
          reason: "INVOICE_DRAW_REWARD",
          sourceType: "INVOICE_DRAW_RESULT",
          sourceId: input.drawId,
          campaignId: input.campaignId,
          ruleId: null,
          createdAt: input.now
        };
        transaction.create(this.db.collection("activity_ledger").doc(rewardLedger.id), rewardLedger);
      }
      if (claim) transaction.create(this.db.collection("prize_claims").doc(claim.id), claim);
      transaction.create(resultReference, result);
      return { result, claim, duplicated: false };
    });
  }

  async listResults(filter: InvoiceDrawResultListFilter): Promise<InvoiceDrawResult[]> {
    const limit = safeLimit(filter.limit);
    let query: FirebaseFirestore.Query = this.db.collection("invoice_draw_results");
    if (filter.userId) query = query.where("userId", "==", filter.userId);
    if (filter.campaignId) query = query.where("campaignId", "==", filter.campaignId);
    const snapshot = await query.orderBy("createdAt", "desc").limit(limit).get();
    return snapshot.docs
      .map((document) => document.data() as InvoiceDrawResult)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  private async getClaimForTransaction(
    transaction: FirebaseFirestore.Transaction,
    claimId: string
  ): Promise<PrizeClaim | null> {
    const snapshot = await transaction.get(this.db.collection("prize_claims").doc(claimId));
    return snapshot.exists ? (snapshot.data() as PrizeClaim) : null;
  }
}
