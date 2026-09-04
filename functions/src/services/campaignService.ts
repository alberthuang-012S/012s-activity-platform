import { ActivityRule } from "../domain/activity/activity.types";
import { Campaign, CampaignWithRules } from "../domain/activity/campaign.types";
import { parseCreateCampaignCommand } from "../domain/activity/campaign.schema";
import { ApplicationError } from "../domain/order/order.errors";
import {
  CampaignRepositoryPort,
  CreateCampaignData
} from "../repositories/campaignRepository";

export class CampaignService {
  constructor(private readonly campaignRepository: CampaignRepositoryPort) {}

  async createCampaign(input: unknown): Promise<CampaignWithRules> {
    const command = parseCreateCampaignCommand(input);
    const data: CreateCampaignData = command;
    return this.campaignRepository.createCampaign(data);
  }

  async getCampaign(campaignId: string): Promise<CampaignWithRules> {
    const campaign = await this.campaignRepository.getCampaignWithRules(campaignId);
    if (!campaign) {
      throw new ApplicationError("CAMPAIGN_NOT_FOUND", "Campaign could not be resolved.");
    }
    return campaign;
  }

  async listCampaigns(): Promise<CampaignWithRules[]> {
    return this.campaignRepository.listCampaigns();
  }

  async activateCampaign(campaignId: string): Promise<Campaign> {
    return this.campaignRepository.activateCampaign(campaignId);
  }

  async listRules(campaignId: string): Promise<ActivityRule[]> {
    return this.campaignRepository.listRulesForCampaign(campaignId);
  }
}
