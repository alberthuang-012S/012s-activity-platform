import { Request, Response } from "express";
import { SessionService } from "../../services/sessionService";
import { sendError, sendSuccess } from "../response";

export async function createDevSession(
  request: Request,
  response: Response,
  sessionService: SessionService
): Promise<void> {
  try {
    const body = request.body as { userId?: unknown };
    const result = await sessionService.createSession(
      typeof body?.userId === "string" ? body.userId : ""
    );
    sendSuccess(response, result, 201);
  } catch (error) {
    sendError(response, error);
  }
}
