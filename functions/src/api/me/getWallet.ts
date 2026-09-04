import { Request, Response } from "express";
import { SessionService } from "../../services/sessionService";
import { WalletService } from "../../services/walletService";
import { sendError, sendSuccess } from "../response";

export async function getMyWallet(
  request: Request,
  response: Response,
  sessionService: SessionService,
  walletService: WalletService
): Promise<void> {
  try {
    const actor = await sessionService.resolveActor(request.get("authorization"));
    const wallet = await walletService.getWalletForUser(actor.userId);
    sendSuccess(response, wallet);
  } catch (error) {
    sendError(response, error);
  }
}
