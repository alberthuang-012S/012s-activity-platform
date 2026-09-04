import * as logger from "firebase-functions/logger";
import { NormalizedCustomer } from "../domain/customer/customer.types";
import {
  ApplicationError,
  toApplicationError
} from "../domain/order/order.errors";
import { validateNormalizedOrder } from "../domain/order/order.schema";
import {
  IntegrationEvent,
  IntegrationEventError,
  NormalizedOrder,
  OrderEventContext
} from "../domain/order/order.types";
import {
  CustomerRepositoryPort
} from "../repositories/customerRepository";
import {
  IntegrationEventRepositoryPort,
  newReceivedIntegrationEvent
} from "../repositories/integrationEventRepository";
import { OrderRepositoryPort } from "../repositories/orderRepository";
import { nowIso } from "../utils/dates";
import { createPrefixedId } from "../utils/ids";
import { ActivityEngine } from "./activityEngine";

export interface ProcessOrderError {
  code: string;
  message: string;
}

export interface ProcessOrderResult {
  success: boolean;
  orderId?: string;
  userId?: string;
  duplicated: boolean;
  error?: ProcessOrderError;
}

export interface OrderProcessorDependencies {
  customerRepository: CustomerRepositoryPort;
  orderRepository: OrderRepositoryPort;
  integrationEventRepository: IntegrationEventRepositoryPort;
  activityEngine?: ActivityEngine;
}

function eventError(error: ApplicationError): IntegrationEventError {
  return { code: error.code, message: error.message };
}

function normalizedCustomer(order: NormalizedOrder): NormalizedCustomer {
  return {
    provider: order.customer.provider,
    externalCustomerId: order.customer.externalCustomerId
  };
}

function resultError(error: ApplicationError): ProcessOrderError {
  return { code: error.code, message: error.message };
}

function safeStringProperty(value: unknown, property: string, fallback: string): string {
  if (typeof value !== "object" || value === null) {
    return fallback;
  }

  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : fallback;
}

function defaultEventContext(normalizedOrder: NormalizedOrder): OrderEventContext {
  return {
    provider: safeStringProperty(normalizedOrder, "source", "unknown"),
    externalEventId: `INTERNAL-EVENT-${createPrefixedId("EVT")}`,
    externalOrderId: safeStringProperty(normalizedOrder, "externalOrderId", "")
  };
}

export class OrderProcessor {
  constructor(private readonly dependencies: OrderProcessorDependencies) {}

  async recordFailure(context: OrderEventContext, error: unknown): Promise<void> {
    const applicationError = toApplicationError(error);
    const event = await this.dependencies.integrationEventRepository.create({
      ...newReceivedIntegrationEvent(context),
      status: "failed",
      processedAt: nowIso(),
      error: eventError(applicationError)
    });

    logger.error("order_processing_failed_before_normalization", {
      provider: context.provider,
      externalOrderId: context.externalOrderId,
      eventId: event.id,
      errorCode: applicationError.code
    });
  }

  async processOrder(
    normalizedOrder: NormalizedOrder,
    context: OrderEventContext = defaultEventContext(normalizedOrder)
  ): Promise<ProcessOrderResult> {
    let event: IntegrationEvent | null = null;
    let externalOrderId = context.externalOrderId;
    let persistedOrderId: string | undefined;
    let persistedUserId: string | undefined;

    try {
      const source = safeStringProperty(normalizedOrder, "source", context.provider);
      const candidateExternalOrderId = safeStringProperty(
        normalizedOrder,
        "externalOrderId",
        context.externalOrderId
      );
      const candidateStatus = safeStringProperty(normalizedOrder, "status", "received");
      event = await this.dependencies.integrationEventRepository.create({
        ...newReceivedIntegrationEvent({
          ...context,
          provider: source,
          externalOrderId: candidateExternalOrderId,
          eventType: context.eventType ?? `order.${candidateStatus}`
        })
      });
      externalOrderId = candidateExternalOrderId;

      await this.dependencies.integrationEventRepository.updateStatus(
        event.id,
        "processing",
        null,
        null
      );

      validateNormalizedOrder(normalizedOrder);

      const user = await this.dependencies.customerRepository.findUserByExternalIdentity(
        normalizedCustomer(normalizedOrder)
      );
      if (!user) {
        throw new ApplicationError("CUSTOMER_NOT_FOUND", "Customer could not be resolved.");
      }

      const persisted = await this.dependencies.orderRepository.createOrderIfNotExists(
        normalizedOrder,
        user.id
      );
      persistedOrderId = persisted.order.id;
      persistedUserId = persisted.order.userId;

      if (persisted.duplicated) {
        const duplicate = new ApplicationError(
          "DUPLICATE_ORDER",
          "The order has already been processed."
        );
        await this.dependencies.integrationEventRepository.updateStatus(
          event.id,
          "ignored",
          nowIso(),
          eventError(duplicate)
        );
        logger.warn("order_processing_ignored_duplicate", {
          source: normalizedOrder.source,
          externalOrderId,
          orderId: persisted.order.id,
          userId: persisted.order.userId,
          eventId: event.id,
          errorCode: duplicate.code
        });
        return {
          success: false,
          orderId: persisted.order.id,
          userId: persisted.order.userId,
          duplicated: true,
          error: resultError(duplicate)
        };
      }

      let activityCampaignCount = 0;
      if (
        this.dependencies.activityEngine &&
        normalizedOrder.status === "paid"
      ) {
        const activityResult = await this.dependencies.activityEngine.processOrder(persisted.order);
        activityCampaignCount = activityResult.processedCampaigns.length;
        if (!activityResult.success) {
          throw new ApplicationError(
            "ACTIVITY_PROCESSING_FAILED",
            "Activity processing failed."
          );
        }
      }

      await this.dependencies.integrationEventRepository.updateStatus(
        event.id,
        "processed",
        nowIso(),
        null
      );
      logger.info("order_processed", {
        source: normalizedOrder.source,
        externalOrderId,
        orderId: persisted.order.id,
        userId: user.id,
        eventId: event.id,
        activityCampaignCount
      });

      // Phase 2: await activityEngine.processOrder(persisted.order);
      return {
        success: true,
        orderId: persisted.order.id,
        userId: user.id,
        duplicated: false
      };
    } catch (error) {
      const applicationError = toApplicationError(
        error,
        error instanceof ApplicationError ? error.code : "DATABASE_ERROR"
      );

      if (event) {
        try {
          await this.dependencies.integrationEventRepository.updateStatus(
            event.id,
            "failed",
            nowIso(),
            eventError(applicationError)
          );
        } catch (eventUpdateError) {
          const eventUpdateApplicationError = toApplicationError(eventUpdateError);
          logger.error("integration_event_update_failed", {
            source: context.provider,
            externalOrderId,
            eventId: event.id,
            errorCode: eventUpdateApplicationError.code
          });
        }
      }

      logger.error("order_processing_failed", {
        source: context.provider,
        externalOrderId,
        eventId: event?.id ?? null,
        errorCode: applicationError.code
      });
      return {
        success: false,
        orderId: persistedOrderId,
        userId: persistedUserId,
        duplicated: false,
        error: resultError(applicationError)
      };
    }
  }
}

export function createOrderProcessor(dependencies: OrderProcessorDependencies): OrderProcessor {
  return new OrderProcessor(dependencies);
}

export async function processOrder(
  normalizedOrder: NormalizedOrder,
  context: OrderEventContext,
  dependencies: OrderProcessorDependencies
): Promise<ProcessOrderResult> {
  return new OrderProcessor(dependencies).processOrder(normalizedOrder, context);
}
