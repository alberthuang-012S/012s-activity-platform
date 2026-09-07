import { createHash, randomBytes } from "node:crypto";
import { ApplicationError } from "../domain/order/order.errors";
import { ActorContext } from "../domain/session/session.types";
import {
  createInvoiceDrawId,
  hashInvoiceDrawIdempotencyKey,
  parseInvoiceDrawIdempotencyKey
} from "../domain/invoiceDraw/invoiceDraw.schema";
import {
  InvoiceDrawResponse,
  InvoiceDrawResult,
  PrizeClaimStatus
} from "../domain/invoiceDraw/invoiceDraw.types";
import {
  ExecuteInvoiceDrawInput,
  InvoiceDrawResultRepositoryPort
} from "../repositories/invoiceDrawResultRepository";
import { PrizeClaimRepositoryPort } from "../repositories/prizeClaimRepository";

export interface InvoiceDrawServiceDependencies {
  resultRepository: InvoiceDrawResultRepositoryPort;
  claimRepository: PrizeClaimRepositoryPort;
  getAvailableCampaign: (now: string) => Promise<{ id: string } | null>;
  clock?: () => Date;
  randomBytes?: (size: number) => Buffer;
}

function resultToResponse(
  result: InvoiceDrawResult,
  claim: { id: string; status: PrizeClaimStatus } | null
): InvoiceDrawResponse {
  return {
    drawId: result.drawId,
    campaignId: result.campaignId,
    prize: { ...result.prize },
    won: result.won,
    claim,
    balances: { ...result.balances },
    createdAt: result.createdAt
  };
}

export class InvoiceDrawService {
  private readonly clock: () => Date;
  private readonly randomBytes: (size: number) => Buffer;

  constructor(private readonly dependencies: InvoiceDrawServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.randomBytes = dependencies.randomBytes ?? randomBytes;
  }

  async draw(actor: ActorContext, rawIdempotencyKey: unknown): Promise<InvoiceDrawResponse> {
    if (!actor || typeof actor.userId !== "string" || actor.userId.trim().length === 0) {
      throw new ApplicationError("INVALID_SESSION", "A valid actor is required.");
    }
    const idempotencyKey = parseInvoiceDrawIdempotencyKey(rawIdempotencyKey);
    const drawId = createInvoiceDrawId(actor.userId, idempotencyKey);
    const existing = await this.dependencies.resultRepository.getResult(drawId);
    if (existing) return this.toResponse(existing);

    const currentTime = this.clock();
    if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
      throw new ApplicationError("INTERNAL_ERROR", "Server clock returned an invalid date.");
    }
    const now = currentTime.toISOString();
    const campaign = await this.dependencies.getAvailableCampaign(now);
    if (!campaign) {
      throw new ApplicationError(
        "INVOICE_DRAW_CAMPAIGN_NOT_AVAILABLE",
        "No available invoice draw campaign exists."
      );
    }
    const entropySeed = this.randomBytes(32);
    const input: ExecuteInvoiceDrawInput = {
      drawId,
      userId: actor.userId,
      campaignId: campaign.id,
      idempotencyKeyHash: hashInvoiceDrawIdempotencyKey(idempotencyKey),
      entropyHash: createHash("sha256").update(entropySeed).digest("hex"),
      entropySeed,
      now
    };
    const executed = await this.dependencies.resultRepository.executeDraw(input);
    return resultToResponse(
      executed.result,
      executed.claim ? { id: executed.claim.id, status: executed.claim.status } : null
    );
  }

  private async toResponse(result: InvoiceDrawResult): Promise<InvoiceDrawResponse> {
    const claim = result.claimId ? await this.dependencies.claimRepository.getClaim(result.claimId) : null;
    return resultToResponse(
      result,
      claim ? { id: claim.id, status: claim.status } : null
    );
  }
}
