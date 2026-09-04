import { Firestore } from "firebase-admin/firestore";
import {
  IntegrationEvent,
  IntegrationEventError,
  IntegrationEventStatus,
  OrderEventContext
} from "../domain/order/order.types";
import { nowIso } from "../utils/dates";
import { createPrefixedId } from "../utils/ids";

export interface NewIntegrationEvent extends Omit<IntegrationEvent, "id"> {}

export interface IntegrationEventRepositoryPort {
  create(event: NewIntegrationEvent): Promise<IntegrationEvent>;
  updateStatus(
    eventId: string,
    status: IntegrationEventStatus,
    processedAt: string | null,
    error: IntegrationEventError | null
  ): Promise<void>;
}

export class IntegrationEventRepository implements IntegrationEventRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async create(event: NewIntegrationEvent): Promise<IntegrationEvent> {
    const id = createPrefixedId("EVT");
    const document: IntegrationEvent = { id, ...event };
    await this.db.collection("integration_events").doc(id).set(document);
    return document;
  }

  async updateStatus(
    eventId: string,
    status: IntegrationEventStatus,
    processedAt: string | null,
    error: IntegrationEventError | null
  ): Promise<void> {
    await this.db.collection("integration_events").doc(eventId).update({
      status,
      processedAt,
      error
    });
  }
}

export function newReceivedIntegrationEvent(context: OrderEventContext): NewIntegrationEvent {
  return {
    provider: context.provider,
    eventType: context.eventType ?? "order.received",
    externalEventId: context.externalEventId,
    externalOrderId: context.externalOrderId,
    status: "received",
    receivedAt: nowIso(),
    processedAt: null,
    error: null
  };
}
