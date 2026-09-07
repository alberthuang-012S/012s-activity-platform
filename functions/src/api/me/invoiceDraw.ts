import { Request, Response } from "express";
import { ApplicationError } from "../../domain/order/order.errors";
import { InvoiceDrawQueryService } from "../../services/invoiceDrawQueryService";
import { SessionService } from "../../services/sessionService";
import { sendError, sendSuccess } from "../response";

function queryValue(request: Request, key: string): unknown {
  const value = request.query?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function queryLimit(request: Request): number | undefined {
  const raw = queryValue(request, "limit");
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new ApplicationError("INVALID_INVOICE_DRAW_REQUEST", "limit must be an integer between 1 and 50.");
  }
  return parsed;
}

export async function getMyInvoiceDrawStatus(
  request: Request,
  response: Response,
  sessionService: SessionService,
  queryService: InvoiceDrawQueryService
): Promise<void> {
  try {
    const actor = await sessionService.resolveActor(request.get("authorization"));
    sendSuccess(response, await queryService.getStatus(actor.userId));
  } catch (error) {
    sendError(response, error);
  }
}

export async function getMyInvoiceDrawResults(
  request: Request,
  response: Response,
  sessionService: SessionService,
  queryService: InvoiceDrawQueryService
): Promise<void> {
  try {
    const actor = await sessionService.resolveActor(request.get("authorization"));
    sendSuccess(response, await queryService.listUserResults(actor.userId, queryLimit(request)));
  } catch (error) {
    sendError(response, error);
  }
}

export async function getMyPrizeClaims(
  request: Request,
  response: Response,
  sessionService: SessionService,
  queryService: InvoiceDrawQueryService
): Promise<void> {
  try {
    const actor = await sessionService.resolveActor(request.get("authorization"));
    sendSuccess(response, await queryService.listUserClaims(actor.userId, queryLimit(request)));
  } catch (error) {
    sendError(response, error);
  }
}
