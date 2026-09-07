import { ApplicationError } from "../domain/order/order.errors";
import { PrizeClaim } from "../domain/invoiceDraw/invoiceDraw.types";
import { PrizeClaimRepositoryPort } from "../repositories/prizeClaimRepository";

export class PrizeClaimService {
  constructor(private readonly repository: PrizeClaimRepositoryPort) {}

  async listClaims(filter: { userId?: string; status?: "pending" | "fulfilled"; limit?: number }): Promise<PrizeClaim[]> {
    return this.repository.listClaims(filter);
  }

  async getClaim(claimId: string): Promise<PrizeClaim> {
    const claim = await this.repository.getClaim(claimId);
    if (!claim) throw new ApplicationError("PRIZE_CLAIM_NOT_FOUND", "Prize claim could not be resolved.");
    return claim;
  }

  async fulfillClaim(claimId: string, note: string | null): Promise<PrizeClaim> {
    return this.repository.fulfillClaim(claimId, note);
  }
}
