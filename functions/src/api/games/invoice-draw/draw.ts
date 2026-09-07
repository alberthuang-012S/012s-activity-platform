import { Request, Response } from "express";
import { ApplicationError } from "../../../domain/order/order.errors";
import { InvoiceDrawService } from "../../../services/invoiceDrawService";
import { SessionService } from "../../../services/sessionService";
import { sendError, sendSuccess } from "../../response";

export async function drawInvoiceDraw(
  request: Request,
  response: Response,
  sessionService: SessionService,
  invoiceDrawService: InvoiceDrawService
): Promise<void> {
  try {
    const actor = await sessionService.resolveActor(request.get("authorization"));
    const body = request.body;
    if (
      body !== undefined &&
      body !== null &&
      (typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0)
    ) {
      throw new ApplicationError(
        "INVALID_INVOICE_DRAW_REQUEST",
        "Invoice draw request body must be empty."
      );
    }
    const result = await invoiceDrawService.draw(actor, request.get("idempotency-key"));
    sendSuccess(response, result);
  } catch (error) {
    sendError(response, error);
  }
}
