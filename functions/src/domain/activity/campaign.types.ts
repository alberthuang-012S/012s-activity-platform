export type CampaignType = "purchase";
export type CampaignCategory = "product" | "cumulative_spend";
export type CampaignStatus = "draft" | "active" | "ended";

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  category?: CampaignCategory;
  status: CampaignStatus;
  timezone: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignWithRules {
  campaign: Campaign;
  rules: import("./activity.types").ActivityRule[];
}
