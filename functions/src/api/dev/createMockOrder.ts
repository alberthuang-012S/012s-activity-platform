import { Request, Response } from "express";
import { ApplicationError, isErrorCode } from "../../domain/order/order.errors";
import { MockCommerceAdapter } from "../../integrations/commerce/mock/mockCommerceAdapter";
import { OrderProcessor } from "../../services/orderProcessor";
import { createPrefixedId } from "../../utils/ids";
import { sendError, sendSuccess } from "../response";

export async function createMockOrder(
  request: Request,
  response: Response,
  adapter: MockCommerceAdapter,
  orderProcessor: OrderProcessor
): Promise<void> {
  const body = request.body;
  const rawExternalOrderId =
    typeof body?.externalOrderId === "string" ? body.externalOrderId : "";
  const context = {
    provider: "mock",
    externalEventId: `MOCK-EVENT-${createPrefixedId("EVT")}`,
    externalOrderId: rawExternalOrderId
  } as const;

  try {
    const normalizedOrder = adapter.normalizeOrder(body);
    const result = await orderProcessor.processOrder(normalizedOrder, {
      ...context,
      externalOrderId: normalizedOrder.externalOrderId
    });

    if (!result.success) {
      const error = result.error ?? {
        code: "INTERNAL_ERROR",
        message: "The order could not be processed."
      };
      const errorCode = isErrorCode(error.code) ? error.code : "INTERNAL_ERROR";
      sendError(response, new ApplicationError(errorCode, error.message));
      return;
    }

    sendSuccess(
      response,
      {
        orderId: result.orderId,
        userId: result.userId,
        externalOrderId: normalizedOrder.externalOrderId
      },
      201
    );
  } catch (error) {
    try {
      await orderProcessor.recordFailure(context, error);
    } catch (eventError) {
      sendError(response, eventError);
      return;
    }
    sendError(response, error);
  }
}
