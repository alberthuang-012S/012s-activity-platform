import { Firestore } from "firebase-admin/firestore";
import { ActivityLedgerEntry } from "../domain/activity/ledger.types";

export interface ActivityLedgerRepositoryPort {
  listForUser(userId: string, limit?: number): Promise<ActivityLedgerEntry[]>;
  listForOrder(orderId: string): Promise<ActivityLedgerEntry[]>;
}

function safeLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), 300);
}

export class ActivityLedgerRepository implements ActivityLedgerRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async listForUser(userId: string, limit = 300): Promise<ActivityLedgerEntry[]> {
    const snapshot = await this.db
      .collection("activity_ledger")
      .where("userId", "==", userId)
      .limit(safeLimit(limit))
      .get();
    return snapshot.docs
      .map((document) => document.data() as ActivityLedgerEntry)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listForOrder(orderId: string): Promise<ActivityLedgerEntry[]> {
    const snapshot = await this.db
      .collection("activity_ledger")
      .where("sourceId", "==", orderId)
      .get();
    return snapshot.docs.map((document) => document.data() as ActivityLedgerEntry);
  }
}
