import { Firestore } from "firebase-admin/firestore";
import { ApplicationError } from "../domain/order/order.errors";
import { NormalizedOrder, StoredOrder } from "../domain/order/order.types";
import { nowIso } from "../utils/dates";
import { createExternalDocumentKey, createPrefixedId } from "../utils/ids";

export interface CreateOrderIfNotExistsResult {
  order: StoredOrder;
  duplicated: boolean;
}

export interface OrderRepositoryPort {
  createOrderIfNotExists(
    normalizedOrder: NormalizedOrder,
    userId: string
  ): Promise<CreateOrderIfNotExistsResult>;
  getOrder?(orderId: string): Promise<StoredOrder | null>;
  listRecentOrders(limit?: number): Promise<StoredOrder[]>;
  listOrdersForUser(userId: string, limit?: number): Promise<StoredOrder[]>;
}

export class OrderRepository implements OrderRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async createOrderIfNotExists(
    normalizedOrder: NormalizedOrder,
    userId: string
  ): Promise<CreateOrderIfNotExistsResult> {
    const externalKeyId = createExternalDocumentKey(
      normalizedOrder.source,
      normalizedOrder.externalOrderId
    );
    const externalKeyReference = this.db.collection("order_external_keys").doc(externalKeyId);

    return this.db.runTransaction(async (transaction) => {
      const existingKey = await transaction.get(externalKeyReference);
      if (existingKey.exists) {
        const existingKeyData = existingKey.data() as { orderId?: string };
        if (typeof existingKeyData.orderId !== "string" || existingKeyData.orderId.length === 0) {
          throw new ApplicationError(
            "DATABASE_ERROR",
            "The order external key is missing its order reference."
          );
        }

        const existingOrderReference = this.db.collection("orders").doc(existingKeyData.orderId);
        const existingOrder = await transaction.get(existingOrderReference);
        if (!existingOrder.exists) {
          throw new ApplicationError(
            "DATABASE_ERROR",
            "The order external key points to a missing order."
          );
        }

        return {
          order: existingOrder.data() as StoredOrder,
          duplicated: true
        };
      }

      const orderId = createPrefixedId("ORD");
      const timestamp = nowIso();
      const order: StoredOrder = {
        ...normalizedOrder,
        id: orderId,
        userId,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const orderReference = this.db.collection("orders").doc(orderId);

      transaction.set(orderReference, order);
      transaction.set(externalKeyReference, {
        orderId,
        source: normalizedOrder.source,
        externalOrderId: normalizedOrder.externalOrderId
      });

      return { order, duplicated: false };
    });
  }

  async listRecentOrders(limit = 50): Promise<StoredOrder[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const snapshot = await this.db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .limit(safeLimit)
      .get();
    return snapshot.docs.map((document) => document.data() as StoredOrder);
  }

  async getOrder(orderId: string): Promise<StoredOrder | null> {
    const snapshot = await this.db.collection("orders").doc(orderId).get();
    return snapshot.exists ? (snapshot.data() as StoredOrder) : null;
  }

  async listOrdersForUser(userId: string, limit = 100): Promise<StoredOrder[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const snapshot = await this.db
      .collection("orders")
      .where("userId", "==", userId)
      .limit(safeLimit)
      .get();
    return snapshot.docs
      .map((document) => document.data() as StoredOrder)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}
