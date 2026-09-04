import { Request, Response } from "express";
import { CampaignService } from "../../services/campaignService";
import { sendError, sendSuccess } from "../response";

export async function createDevCampaign(
  request: Request,
  response: Response,
  campaignService: CampaignService
): Promise<void> {
  try {
    const campaign = await campaignService.createCampaign(request.body);
    sendSuccess(response, campaign, 201);
  } catch (error) {
    sendError(response, error);
  }
}

export async function listDevCampaigns(
  _request: Request,
  response: Response,
  campaignService: CampaignService
): Promise<void> {
  try {
    sendSuccess(response, await campaignService.listCampaigns());
  } catch (error) {
    sendError(response, error);
  }
}

export async function activateDevCampaign(
  _request: Request,
  response: Response,
  campaignService: CampaignService,
  campaignId: string
): Promise<void> {
  try {
    sendSuccess(response, await campaignService.activateCampaign(decodeURIComponent(campaignId)));
  } catch (error) {
    sendError(response, error);
  }
}
