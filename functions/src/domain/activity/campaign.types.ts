export type CampaignType = "purchase";
export type CampaignStatus = "draft" | "active" | "ended";

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
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
