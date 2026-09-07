import { Firestore } from "firebase-admin/firestore";
import { ApplicationError } from "../domain/order/order.errors";
import { PrizeClaim, PrizeClaimStatus } from "../domain/invoiceDraw/invoiceDraw.types";
import { nowIso } from "../utils/dates";

export interface PrizeClaimListFilter {
  userId?: string;
  status?: PrizeClaimStatus;
  limit?: number;
}

export interface PrizeClaimRepositoryPort {
  getClaim(claimId: string): Promise<PrizeClaim | null>;
  listClaims(filter: PrizeClaimListFilter): Promise<PrizeClaim[]>;
  fulfillClaim(claimId: string, note: string | null): Promise<PrizeClaim>;
}

function safeLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new ApplicationError("INVALID_INVOICE_DRAW_REQUEST", "limit must be a positive integer.");
  }
  return Math.min(limit, 50);
}

export class PrizeClaimRepository implements PrizeClaimRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async getClaim(claimId: string): Promise<PrizeClaim | null> {
    const snapshot = await this.db.collection("prize_claims").doc(claimId).get();
    return snapshot.exists ? (snapshot.data() as PrizeClaim) : null;
  }

  async listClaims(filter: PrizeClaimListFilter): Promise<PrizeClaim[]> {
    const limit = safeLimit(filter.limit);
    let query: FirebaseFirestore.Query = this.db.collection("prize_claims");
    if (filter.userId) query = query.where("userId", "==", filter.userId);
    if (filter.status) query = query.where("status", "==", filter.status);
    const snapshot = await query.orderBy("createdAt", "desc").limit(limit).get();
    return snapshot.docs
      .map((document) => document.data() as PrizeClaim)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async fulfillClaim(claimId: string, note: string | null): Promise<PrizeClaim> {
    const reference = this.db.collection("prize_claims").doc(claimId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        throw new ApplicationError("PRIZE_CLAIM_NOT_FOUND", "Prize claim could not be resolved.");
      }
      const current = snapshot.data() as PrizeClaim;
      if (current.status === "fulfilled") return current;
      if (current.status !== "pending") {
        throw new ApplicationError("PRIZE_CLAIM_INVALID_STATE", "Prize claim is not pending.");
      }
      const timestamp = nowIso();
      const fulfilled: PrizeClaim = {
        ...current,
        status: "fulfilled",
        updatedAt: timestamp,
        fulfilledAt: timestamp,
        fulfillmentNote: note
      };
      transaction.set(reference, fulfilled);
      return fulfilled;
    });
  }
}
