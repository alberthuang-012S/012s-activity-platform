import { Request, Response } from "express";
import { ApplicationError } from "../../domain/order/order.errors";
import { InvoiceDrawCampaignService } from "../../services/invoiceDrawCampaignService";
import { InvoiceDrawQueryService } from "../../services/invoiceDrawQueryService";
import { PrizeClaimService } from "../../services/prizeClaimService";
import { sendError, sendSuccess } from "../response";

function queryValue(request: Request, key: string): string | undefined {
  const value = request.query?.[key];
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
}

function queryLimit(request: Request): number | undefined {
  const value = queryValue(request, "limit");
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new ApplicationError("INVALID_INVOICE_DRAW_REQUEST", "limit must be an integer between 1 and 50.");
  }
  return parsed;
}

function id(value: string): string {
  return decodeURIComponent(value);
}

export async function createDevInvoiceDrawCampaign(request: Request, response: Response, service: InvoiceDrawCampaignService): Promise<void> {
  try {
    sendSuccess(response, await service.createCampaign(request.body), 201);
  } catch (error) {
    sendError(response, error);
  }
}

export async function listDevInvoiceDrawCampaigns(_request: Request, response: Response, service: InvoiceDrawCampaignService): Promise<void> {
  try {
    sendSuccess(response, await service.listCampaigns());
  } catch (error) {
    sendError(response, error);
  }
}

export async function getDevInvoiceDrawCampaign(_request: Request, response: Response, service: InvoiceDrawCampaignService, campaignId: string): Promise<void> {
  try {
    sendSuccess(response, await service.getCampaign(id(campaignId)));
  } catch (error) {
    sendError(response, error);
  }
}

export async function updateDevInvoiceDrawCampaign(request: Request, response: Response, service: InvoiceDrawCampaignService, campaignId: string): Promise<void> {
  try {
    sendSuccess(response, await service.updateCampaign(id(campaignId), request.body));
  } catch (error) {
    sendError(response, error);
  }
}

export async function createDevInvoiceDrawPrize(request: Request, response: Response, service: InvoiceDrawCampaignService, campaignId: string): Promise<void> {
  try {
    sendSuccess(response, await service.createPrize(id(campaignId), request.body), 201);
  } catch (error) {
    sendError(response, error);
  }
}

export async function updateDevInvoiceDrawPrize(request: Request, response: Response, service: InvoiceDrawCampaignService, prizeId: string): Promise<void> {
  try {
    sendSuccess(response, await service.updatePrize(id(prizeId), request.body));
  } catch (error) {
    sendError(response, error);
  }
}

type LifecycleAction = "activate" | "pause" | "resume" | "end";

export async function transitionDevInvoiceDrawCampaign(
  _request: Request,
  response: Response,
  service: InvoiceDrawCampaignService,
  campaignId: string,
  action: LifecycleAction
): Promise<void> {
  try {
    const decodedId = id(campaignId);
    const campaign = action === "activate"
      ? await service.activate(decodedId)
      : action === "pause"
        ? await service.pause(decodedId)
        : action === "resume"
          ? await service.resume(decodedId)
          : await service.end(decodedId);
    sendSuccess(response, campaign);
  } catch (error) {
    sendError(response, error);
  }
}

export async function listDevInvoiceDrawResults(request: Request, response: Response, service: InvoiceDrawQueryService): Promise<void> {
  try {
    sendSuccess(response, await service.listResults({
      campaignId: queryValue(request, "campaignId"),
      userId: queryValue(request, "userId"),
      limit: queryLimit(request)
    }));
  } catch (error) {
    sendError(response, error);
  }
}

export async function listDevPrizeClaims(request: Request, response: Response, service: PrizeClaimService): Promise<void> {
  try {
    const status = queryValue(request, "status");
    if (status !== undefined && status !== "pending" && status !== "fulfilled") {
      throw new ApplicationError("INVALID_INVOICE_DRAW_REQUEST", "status must be pending or fulfilled.");
    }
    sendSuccess(response, await service.listClaims({
      userId: queryValue(request, "userId"),
      status,
      limit: queryLimit(request)
    }));
  } catch (error) {
    sendError(response, error);
  }
}

export async function fulfillDevPrizeClaim(request: Request, response: Response, service: PrizeClaimService, claimId: string): Promise<void> {
  try {
    const note = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? typeof request.body.note === "string" ? request.body.note.trim() || null : null
      : null;
    sendSuccess(response, await service.fulfillClaim(id(claimId), note));
  } catch (error) {
    sendError(response, error);
  }
}
