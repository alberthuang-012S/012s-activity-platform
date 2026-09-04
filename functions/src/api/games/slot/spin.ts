import { Request, Response } from "express";
import { ApplicationError } from "../../../domain/order/order.errors";
import { SessionService } from "../../../services/sessionService";
import { SlotGameService } from "../../../services/slotGameService";
import { sendError, sendSuccess } from "../../response";

function isEmptyRequestBody(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
  );
}

export async function spinSlot(
  request: Request,
  response: Response,
  sessionService: SessionService,
  slotGameService: SlotGameService
): Promise<void> {
  try {
    const actor = await sessionService.resolveActor(request.get("authorization"));
    if (!isEmptyRequestBody(request.body)) {
      throw new ApplicationError(
        "INVALID_SLOT_REQUEST",
        "Slot spin request body must be empty; the server owns the result and reward."
      );
    }
    const result = await slotGameService.spin(actor, request.get("idempotency-key"));
    sendSuccess(response, result);
  } catch (error) {
    sendError(response, error);
  }
}
