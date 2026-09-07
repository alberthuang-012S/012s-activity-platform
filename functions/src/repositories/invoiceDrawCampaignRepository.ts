import { Firestore } from "firebase-admin/firestore";
import { ApplicationError } from "../domain/order/order.errors";
import {
  CreateInvoiceDrawCampaignCommand,
  CreateInvoiceDrawPrizeCommand,
  UpdateInvoiceDrawCampaignCommand,
  UpdateInvoiceDrawPrizeCommand,
  createPrizePoolFingerprint,
  invoiceDrawCampaignIsAvailable,
  invoiceDrawCampaignsOverlap,
  parseCreateInvoiceDrawCampaignCommand,
  validateInvoiceDrawPrize,
  validateInvoiceDrawPrizePool
} from "../domain/invoiceDraw/invoiceDraw.schema";
import {
  INVOICE_DRAW_TIMEZONE,
  MAX_INVOICE_DRAW_PRIZES,
  InvoiceDrawCampaign,
  InvoiceDrawCampaignDetail,
  InvoiceDrawPrize,
  InvoiceDrawPrizeInventory,
  InvoiceDrawPrizeSnapshot
} from "../domain/invoiceDraw/invoiceDraw.types";
import { nowIso } from "../utils/dates";
import { createPrefixedId } from "../utils/ids";

export interface InvoiceDrawCampaignRepositoryPort {
  createCampaign(command: CreateInvoiceDrawCampaignCommand): Promise<InvoiceDrawCampaign>;
  getCampaign(campaignId: string): Promise<InvoiceDrawCampaign | null>;
  getCampaignDetail(campaignId: string): Promise<InvoiceDrawCampaignDetail | null>;
  listCampaignDetails(): Promise<InvoiceDrawCampaignDetail[]>;
  updateCampaign(campaignId: string, updates: UpdateInvoiceDrawCampaignCommand): Promise<InvoiceDrawCampaign>;
  createPrize(campaignId: string, command: CreateInvoiceDrawPrizeCommand): Promise<InvoiceDrawPrize>;
  getPrize(prizeId: string): Promise<InvoiceDrawPrize | null>;
  listPrizes(campaignId: string): Promise<InvoiceDrawPrize[]>;
  updatePrize(prizeId: string, updates: UpdateInvoiceDrawPrizeCommand): Promise<InvoiceDrawPrize>;
  listInventory(campaignId: string): Promise<InvoiceDrawPrizeInventory[]>;
  activateCampaign(campaignId: string): Promise<InvoiceDrawCampaign>;
  pauseCampaign(campaignId: string): Promise<InvoiceDrawCampaign>;
  resumeCampaign(campaignId: string): Promise<InvoiceDrawCampaign>;
  endCampaign(campaignId: string): Promise<InvoiceDrawCampaign>;
  getAvailableCampaign(now: string): Promise<InvoiceDrawCampaign | null>;
  getCurrentCampaign(now: string): Promise<InvoiceDrawCampaign | null>;
}

function campaignFromData(data: FirebaseFirestore.DocumentData | undefined): InvoiceDrawCampaign {
  return data as InvoiceDrawCampaign;
}

function prizeFromData(data: FirebaseFirestore.DocumentData | undefined): InvoiceDrawPrize {
  return data as InvoiceDrawPrize;
}

function inventoryFromData(data: FirebaseFirestore.DocumentData | undefined): InvoiceDrawPrizeInventory {
  return data as InvoiceDrawPrizeInventory;
}

function snapshotFromPrize(prize: InvoiceDrawPrize): InvoiceDrawPrizeSnapshot {
  return {
    prizeId: prize.id,
    code: prize.code,
    displayName: prize.displayName,
    description: prize.description,
    rewardKind: prize.rewardKind,
    points: prize.points,
    weight: prize.weight,
    stockMode: prize.stockMode,
    totalStock: prize.totalStock,
    enabled: prize.enabled,
    displayOrder: prize.displayOrder
  };
}

function campaignError(code: "INVOICE_DRAW_CAMPAIGN_NOT_FOUND" | "INVOICE_DRAW_CAMPAIGN_IMMUTABLE", message: string): never {
  throw new ApplicationError(code, message);
}

export class InvoiceDrawCampaignRepository implements InvoiceDrawCampaignRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async createCampaign(command: CreateInvoiceDrawCampaignCommand): Promise<InvoiceDrawCampaign> {
    const timestamp = nowIso();
    const campaign: InvoiceDrawCampaign = {
      id: createPrefixedId("CAM"),
      name: command.name,
      status: "draft",
      timezone: INVOICE_DRAW_TIMEZONE,
      startsAt: command.startsAt,
      endsAt: command.endsAt,
      configVersion: 1,
      prizePoolSnapshot: [],
      poolFingerprint: null,
      activatedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.db.collection("invoice_draw_campaigns").doc(campaign.id).create(campaign);
    return campaign;
  }

  async getCampaign(campaignId: string): Promise<InvoiceDrawCampaign | null> {
    const snapshot = await this.db.collection("invoice_draw_campaigns").doc(campaignId).get();
    return snapshot.exists ? campaignFromData(snapshot.data()) : null;
  }

  async getCampaignDetail(campaignId: string): Promise<InvoiceDrawCampaignDetail | null> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) return null;
    const [prizes, inventories] = await Promise.all([
      this.listPrizes(campaignId),
      this.listInventory(campaignId)
    ]);
    return { campaign, prizes, inventories };
  }

  async listCampaignDetails(): Promise<InvoiceDrawCampaignDetail[]> {
    const snapshot = await this.db
      .collection("invoice_draw_campaigns")
      .orderBy("updatedAt", "desc")
      .get();
    return Promise.all(snapshot.docs.map(async (document) => {
      const detail = await this.getCampaignDetail(document.id);
      if (!detail) throw new ApplicationError("INVOICE_DRAW_CAMPAIGN_NOT_FOUND", "Campaign could not be resolved.");
      return detail;
    }));
  }

  async updateCampaign(
    campaignId: string,
    updates: UpdateInvoiceDrawCampaignCommand
  ): Promise<InvoiceDrawCampaign> {
    const reference = this.db.collection("invoice_draw_campaigns").doc(campaignId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        campaignError("INVOICE_DRAW_CAMPAIGN_NOT_FOUND", "Invoice draw campaign could not be resolved.");
      }
      const current = campaignFromData(snapshot.data());
      if (current.status !== "draft") {
        campaignError("INVOICE_DRAW_CAMPAIGN_IMMUTABLE", "Only draft campaigns can be edited.");
      }
      const merged = parseCreateInvoiceDrawCampaignCommand({ ...current, ...updates });
      const updated: InvoiceDrawCampaign = {
        ...current,
        ...merged,
        updatedAt: nowIso()
      };
      transaction.set(reference, updated);
      return updated;
    });
  }

  async createPrize(campaignId: string, command: CreateInvoiceDrawPrizeCommand): Promise<InvoiceDrawPrize> {
    const campaignReference = this.db.collection("invoice_draw_campaigns").doc(campaignId);
    const prizeReference = this.db.collection("invoice_draw_prizes").doc(createPrefixedId("PRIZE"));
    return this.db.runTransaction(async (transaction) => {
      const campaignSnapshot = await transaction.get(campaignReference);
      if (!campaignSnapshot.exists) {
        campaignError("INVOICE_DRAW_CAMPAIGN_NOT_FOUND", "Invoice draw campaign could not be resolved.");
      }
      const campaign = campaignFromData(campaignSnapshot.data());
      if (campaign.status !== "draft") {
        campaignError("INVOICE_DRAW_CAMPAIGN_IMMUTABLE", "Prizes cannot be changed after activation.");
      }
      const prizeQuery = this.db.collection("invoice_draw_prizes").where("campaignId", "==", campaignId);
      const existingSnapshot = await transaction.get(prizeQuery);
      if (existingSnapshot.size >= MAX_INVOICE_DRAW_PRIZES) {
        throw new ApplicationError(
          "INVALID_INVOICE_DRAW_PRIZE",
          `A campaign cannot contain more than ${MAX_INVOICE_DRAW_PRIZES} prizes.`
        );
      }
      if (existingSnapshot.docs.some((document) => prizeFromData(document.data()).code === command.code)) {
        throw new ApplicationError("INVALID_INVOICE_DRAW_PRIZE", "Prize code must be unique within a campaign.");
      }
      const timestamp = nowIso();
      const prize: InvoiceDrawPrize = {
        id: prizeReference.id,
        campaignId,
        ...command,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      transaction.create(prizeReference, prize);
      transaction.update(campaignReference, { updatedAt: timestamp });
      return prize;
    });
  }

  async getPrize(prizeId: string): Promise<InvoiceDrawPrize | null> {
    const snapshot = await this.db.collection("invoice_draw_prizes").doc(prizeId).get();
    return snapshot.exists ? prizeFromData(snapshot.data()) : null;
  }

  async listPrizes(campaignId: string): Promise<InvoiceDrawPrize[]> {
    const snapshot = await this.db
      .collection("invoice_draw_prizes")
      .where("campaignId", "==", campaignId)
      .get();
    return snapshot.docs
      .map((document) => prizeFromData(document.data()))
      .sort((left, right) => left.displayOrder - right.displayOrder || left.createdAt.localeCompare(right.createdAt));
  }

  async updatePrize(prizeId: string, updates: UpdateInvoiceDrawPrizeCommand): Promise<InvoiceDrawPrize> {
    const prizeReference = this.db.collection("invoice_draw_prizes").doc(prizeId);
    return this.db.runTransaction(async (transaction) => {
      const prizeSnapshot = await transaction.get(prizeReference);
      if (!prizeSnapshot.exists) {
        throw new ApplicationError("INVALID_INVOICE_DRAW_PRIZE", "Prize could not be resolved.");
      }
      const current = prizeFromData(prizeSnapshot.data());
      const campaignReference = this.db.collection("invoice_draw_campaigns").doc(current.campaignId);
      const campaignSnapshot = await transaction.get(campaignReference);
      if (!campaignSnapshot.exists) {
        campaignError("INVOICE_DRAW_CAMPAIGN_NOT_FOUND", "Invoice draw campaign could not be resolved.");
      }
      const campaign = campaignFromData(campaignSnapshot.data());
      if (campaign.status !== "draft") {
        campaignError("INVOICE_DRAW_CAMPAIGN_IMMUTABLE", "Prizes cannot be changed after activation.");
      }
      const merged = { ...current, ...updates } as InvoiceDrawPrize;
      if (merged.stockMode === "UNLIMITED") merged.totalStock = null;
      validateInvoiceDrawPrize(merged);
      const allPrizesSnapshot = await transaction.get(
        this.db.collection("invoice_draw_prizes").where("campaignId", "==", current.campaignId)
      );
      const allPrizes = allPrizesSnapshot.docs
        .map((document) => document.id === prizeId ? merged : prizeFromData(document.data()));
      if (allPrizes.some((candidate) => candidate.id !== prizeId && candidate.code === merged.code)) {
        throw new ApplicationError("INVALID_INVOICE_DRAW_PRIZE", "Prize code must be unique within a campaign.");
      }
      const updated: InvoiceDrawPrize = { ...merged, updatedAt: nowIso() };
      transaction.set(prizeReference, updated);
      transaction.update(campaignReference, { updatedAt: updated.updatedAt });
      return updated;
    });
  }

  async listInventory(campaignId: string): Promise<InvoiceDrawPrizeInventory[]> {
    const snapshot = await this.db
      .collection("invoice_draw_prize_inventory")
      .where("campaignId", "==", campaignId)
      .get();
    return snapshot.docs.map((document) => inventoryFromData(document.data()));
  }

  async activateCampaign(campaignId: string): Promise<InvoiceDrawCampaign> {
    const campaignReference = this.db.collection("invoice_draw_campaigns").doc(campaignId);
    return this.db.runTransaction(async (transaction) => {
      const campaignSnapshot = await transaction.get(campaignReference);
      if (!campaignSnapshot.exists) {
        campaignError("INVOICE_DRAW_CAMPAIGN_NOT_FOUND", "Invoice draw campaign could not be resolved.");
      }
      const current = campaignFromData(campaignSnapshot.data());
      if (current.status === "active") return current;
      if (current.status !== "draft") {
        campaignError("INVOICE_DRAW_CAMPAIGN_IMMUTABLE", "Only draft campaigns can be activated.");
      }

      const prizesSnapshot = await transaction.get(
        this.db.collection("invoice_draw_prizes").where("campaignId", "==", campaignId)
      );
      const activeCampaignsSnapshot = await transaction.get(
        this.db.collection("invoice_draw_campaigns").where("status", "in", ["active", "paused"])
      );
      const prizes = prizesSnapshot.docs.map((document) => prizeFromData(document.data()));
      validateInvoiceDrawPrizePool(prizes);
      const overlap = activeCampaignsSnapshot.docs
        .map((document) => campaignFromData(document.data()))
        .filter((candidate) => candidate.id !== campaignId)
        .some((candidate) => invoiceDrawCampaignsOverlap(current, candidate));
      if (overlap) {
        throw new ApplicationError(
          "INVOICE_DRAW_CAMPAIGN_OVERLAP",
          "Another active or paused invoice draw campaign overlaps this campaign window."
        );
      }

      const prizePoolSnapshot = prizes
        .map(snapshotFromPrize)
        .sort((left, right) => left.displayOrder - right.displayOrder || left.prizeId.localeCompare(right.prizeId));
      const timestamp = nowIso();
      const updated: InvoiceDrawCampaign = {
        ...current,
        status: "active",
        configVersion: current.configVersion + 1,
        prizePoolSnapshot,
        poolFingerprint: createPrizePoolFingerprint(prizePoolSnapshot),
        activatedAt: timestamp,
        updatedAt: timestamp
      };
      transaction.set(campaignReference, updated);
      for (const prize of prizePoolSnapshot) {
        if (prize.stockMode !== "LIMITED" || prize.totalStock === null) continue;
        const inventoryReference = this.db.collection("invoice_draw_prize_inventory").doc(prize.prizeId);
        transaction.create(inventoryReference, {
          prizeId: prize.prizeId,
          campaignId,
          totalStock: prize.totalStock,
          remainingStock: prize.totalStock,
          createdAt: timestamp,
          updatedAt: timestamp
        } satisfies InvoiceDrawPrizeInventory);
      }
      return updated;
    });
  }

  async pauseCampaign(campaignId: string): Promise<InvoiceDrawCampaign> {
    return this.changeStatus(campaignId, "active", "paused");
  }

  async resumeCampaign(campaignId: string): Promise<InvoiceDrawCampaign> {
    return this.changeStatus(campaignId, "paused", "active");
  }

  async endCampaign(campaignId: string): Promise<InvoiceDrawCampaign> {
    const reference = this.db.collection("invoice_draw_campaigns").doc(campaignId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        campaignError("INVOICE_DRAW_CAMPAIGN_NOT_FOUND", "Invoice draw campaign could not be resolved.");
      }
      const current = campaignFromData(snapshot.data());
      if (current.status === "ended") return current;
      if (current.status !== "active" && current.status !== "paused") {
        throw new ApplicationError("INVOICE_DRAW_CAMPAIGN_IMMUTABLE", "Only active or paused campaigns can end.");
      }
      const updated = { ...current, status: "ended" as const, updatedAt: nowIso() };
      transaction.set(reference, updated);
      return updated;
    });
  }

  private async changeStatus(
    campaignId: string,
    expected: "active" | "paused",
    next: "active" | "paused"
  ): Promise<InvoiceDrawCampaign> {
    const reference = this.db.collection("invoice_draw_campaigns").doc(campaignId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        campaignError("INVOICE_DRAW_CAMPAIGN_NOT_FOUND", "Invoice draw campaign could not be resolved.");
      }
      const current = campaignFromData(snapshot.data());
      if (current.status === next) return current;
      if (current.status !== expected) {
        throw new ApplicationError(
          "INVOICE_DRAW_CAMPAIGN_IMMUTABLE",
          `Only ${expected} campaigns can transition to ${next}.`
        );
      }
      const updated = { ...current, status: next, updatedAt: nowIso() };
      transaction.set(reference, updated);
      return updated;
    });
  }

  async getAvailableCampaign(now: string): Promise<InvoiceDrawCampaign | null> {
    const snapshot = await this.db
      .collection("invoice_draw_campaigns")
      .where("status", "==", "active")
      .get();
    return snapshot.docs
      .map((document) => campaignFromData(document.data()))
      .filter((campaign) => invoiceDrawCampaignIsAvailable(campaign, now))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  }

  async getCurrentCampaign(_now: string): Promise<InvoiceDrawCampaign | null> {
    const snapshot = await this.db
      .collection("invoice_draw_campaigns")
      .where("status", "in", ["active", "paused"])
      .get();
    return snapshot.docs
      .map((document) => campaignFromData(document.data()))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  }
}
