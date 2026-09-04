import { Request, Response } from "express";
import { ActivityQueryService } from "../../services/activityQueryService";
import { sendError, sendSuccess } from "../response";

export async function getOrderActivity(
  _request: Request,
  response: Response,
  activityQueryService: ActivityQueryService,
  orderId: string
): Promise<void> {
  try {
    sendSuccess(response, await activityQueryService.getOrderActivity(decodeURIComponent(orderId)));
  } catch (error) {
    sendError(response, error);
  }
}
