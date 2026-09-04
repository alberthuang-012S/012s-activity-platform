import { Firestore } from "firebase-admin/firestore";
import { Entitlement } from "../domain/activity/entitlement.types";

export interface EntitlementRepositoryPort {
  listForUser(userId: string, limit?: number): Promise<Entitlement[]>;
  listForOrder(orderId: string): Promise<Entitlement[]>;
}

function safeLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}

export class EntitlementRepository implements EntitlementRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async listForUser(userId: string, limit = 200): Promise<Entitlement[]> {
    const snapshot = await this.db
      .collection("entitlements")
      .where("userId", "==", userId)
      .limit(safeLimit(limit))
      .get();
    return snapshot.docs
      .map((document) => document.data() as Entitlement)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listForOrder(orderId: string): Promise<Entitlement[]> {
    const snapshot = await this.db
      .collection("entitlements")
      .where("orderId", "==", orderId)
      .get();
    return snapshot.docs.map((document) => document.data() as Entitlement);
  }
}
