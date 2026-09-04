import { Request, Response } from "express";
import { ActivityQueryService } from "../../services/activityQueryService";
import { sendError, sendSuccess } from "../response";

export async function getCustomerActivity(
  _request: Request,
  response: Response,
  activityQueryService: ActivityQueryService,
  userId: string
): Promise<void> {
  try {
    sendSuccess(
      response,
      await activityQueryService.getCustomerActivityProfile(decodeURIComponent(userId))
    );
  } catch (error) {
    sendError(response, error);
  }
}
