import { Firestore } from "firebase-admin/firestore";
import { ApplicationError } from "../domain/order/order.errors";
import { ActivityRule, NewActivityRule } from "../domain/activity/activity.types";
import { Campaign, CampaignWithRules } from "../domain/activity/campaign.types";
import { validateActivityRule } from "../domain/activity/campaign.schema";
import { nowIso } from "../utils/dates";
import { createPrefixedId } from "../utils/ids";

export interface CreateCampaignData {
  name: string;
  type: "purchase";
  category?: import("../domain/activity/campaign.types").CampaignCategory;
  timezone: string;
  startsAt: string;
  endsAt: string;
  rules: NewActivityRule[];
}

export interface CampaignRepositoryPort {
  endCampaign?(campaignId: string): Promise<Campaign>;
  createCampaign(data: CreateCampaignData): Promise<CampaignWithRules>;
  getCampaign(campaignId: string): Promise<Campaign | null>;
  getCampaignWithRules(campaignId: string): Promise<CampaignWithRules | null>;
  listCampaigns(): Promise<CampaignWithRules[]>;
  listActivePurchaseCampaigns(): Promise<Campaign[]>;
  listRulesForCampaign(campaignId: string): Promise<ActivityRule[]>;
  activateCampaign(campaignId: string): Promise<Campaign>;
  updateRule(ruleId: string, updates: Partial<NewActivityRule>): Promise<ActivityRule>;
}

function campaignFromSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot): Campaign {
  return snapshot.data() as Campaign;
}

function ruleFromSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot): ActivityRule {
  return snapshot.data() as ActivityRule;
}

export class CampaignRepository implements CampaignRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async endCampaign(campaignId: string): Promise<Campaign> {
    const reference = this.db.collection("campaigns").doc(campaignId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new ApplicationError("CAMPAIGN_NOT_FOUND", "Campaign could not be resolved.");
      const campaign = campaignFromSnapshot(snapshot);
      const updated: Campaign = { ...campaign, status: "ended", updatedAt: nowIso() };
      transaction.set(reference, updated);
      return updated;
    });
  }

  async createCampaign(data: CreateCampaignData): Promise<CampaignWithRules> {
    const campaignId = createPrefixedId("CAM");
    const timestamp = nowIso();
    const campaign: Campaign = {
      id: campaignId,
      name: data.name,
      type: data.type,
      ...(data.category === undefined ? {} : { category: data.category }),
      status: "draft",
      timezone: data.timezone,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const campaignReference = this.db.collection("campaigns").doc(campaignId);
    const rules = data.rules.map((rule) => ({
      ...rule,
      id: createPrefixedId("RULE"),
      campaignId
    })) as ActivityRule[];

    await this.db.runTransaction(async (transaction) => {
      transaction.set(campaignReference, campaign);
      for (const rule of rules) {
        transaction.set(this.db.collection("activity_rules").doc(rule.id), rule);
      }
    });

    return { campaign, rules };
  }

  async getCampaign(campaignId: string): Promise<Campaign | null> {
    const snapshot = await this.db.collection("campaigns").doc(campaignId).get();
    return snapshot.exists ? campaignFromSnapshot(snapshot) : null;
  }

  async getCampaignWithRules(campaignId: string): Promise<CampaignWithRules | null> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) {
      return null;
    }
    return {
      campaign,
      rules: await this.listRulesForCampaign(campaignId)
    };
  }

  async listCampaigns(): Promise<CampaignWithRules[]> {
    const snapshot = await this.db.collection("campaigns").orderBy("updatedAt", "desc").get();
    return Promise.all(
      snapshot.docs.map(async (document) => ({
        campaign: campaignFromSnapshot(document),
        rules: await this.listRulesForCampaign(document.id)
      }))
    );
  }

  async listActivePurchaseCampaigns(): Promise<Campaign[]> {
    const snapshot = await this.db
      .collection("campaigns")
      .where("status", "==", "active")
      .get();
    return snapshot.docs
      .map((document) => campaignFromSnapshot(document))
      .filter((campaign) => campaign.type === "purchase");
  }

  async listRulesForCampaign(campaignId: string): Promise<ActivityRule[]> {
    const snapshot = await this.db
      .collection("activity_rules")
      .where("campaignId", "==", campaignId)
      .get();
    return snapshot.docs.map(ruleFromSnapshot);
  }

  async activateCampaign(campaignId: string): Promise<Campaign> {
    const campaignReference = this.db.collection("campaigns").doc(campaignId);

    return this.db.runTransaction(async (transaction) => {
      const campaignSnapshot = await transaction.get(campaignReference);
      if (!campaignSnapshot.exists) {
        throw new ApplicationError("CAMPAIGN_NOT_FOUND", "Campaign could not be resolved.");
      }

      const campaign = campaignFromSnapshot(campaignSnapshot);
      if (campaign.status === "active") {
        return campaign;
      }
      if (campaign.status !== "draft") {
        throw new ApplicationError(
          "CAMPAIGN_IMMUTABLE",
          "Only draft campaigns can be activated."
        );
      }

      const updated: Campaign = {
        ...campaign,
        status: "active",
        updatedAt: nowIso()
      };
      transaction.set(campaignReference, updated);
      return updated;
    });
  }

  async updateRule(ruleId: string, updates: Partial<NewActivityRule>): Promise<ActivityRule> {
    const ruleReference = this.db.collection("activity_rules").doc(ruleId);

    return this.db.runTransaction(async (transaction) => {
      const ruleSnapshot = await transaction.get(ruleReference);
      if (!ruleSnapshot.exists) {
        throw new ApplicationError("INVALID_ACTIVITY_RULE", "Activity rule could not be resolved.");
      }

      const current = ruleFromSnapshot(ruleSnapshot);
      const campaignSnapshot = await transaction.get(
        this.db.collection("campaigns").doc(current.campaignId)
      );
      if (!campaignSnapshot.exists) {
        throw new ApplicationError("CAMPAIGN_NOT_FOUND", "Campaign could not be resolved.");
      }
      const campaign = campaignFromSnapshot(campaignSnapshot);
      if (campaign.status !== "draft") {
        throw new ApplicationError(
          "CAMPAIGN_IMMUTABLE",
          "Rules cannot be changed after a campaign is active."
        );
      }

      const updated = {
        ...current,
        ...updates,
        id: current.id,
        campaignId: current.campaignId
      } as ActivityRule;
      validateActivityRule(updated);
      if (campaign.category && updated.type !== (campaign.category === "product" ? "PRODUCT_QUANTITY" : "CUMULATIVE_SPEND")) {
        throw new ApplicationError("INVALID_ACTIVITY_RULE", "Rule must match campaign category.");
      }
      transaction.set(ruleReference, updated);
      return updated;
    });
  }
}
