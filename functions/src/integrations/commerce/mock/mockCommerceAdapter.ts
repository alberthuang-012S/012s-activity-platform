import { ApplicationError } from "../../../domain/order/order.errors";
import { NormalizedOrder, OrderStatus } from "../../../domain/order/order.types";
import { nowIso } from "../../../utils/dates";
import { isRecord } from "../../../utils/validation";
import { CommerceAdapter } from "../commerceAdapter";

export interface MockOrderItemPayload {
  productId: string;
  sku?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface MockOrderPayload {
  externalOrderId: string;
  externalCustomerId: string;
  status: OrderStatus;
  amount: number;
  items: MockOrderItemPayload[];
  invoiceNumber?: string | null;
}

const ORDER_STATUSES: readonly OrderStatus[] = ["pending", "paid", "cancelled", "refunded"];

function invalid(message: string): never {
  throw new ApplicationError("INVALID_ORDER", message);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${field} is required.`);
  }
  return value.trim();
}

function nonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalid(`${field} must be a finite number greater than or equal to zero.`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    invalid(`${field} must be an integer greater than zero.`);
  }
  return value;
}

function normalizeItems(value: unknown): MockOrderItemPayload[] {
  if (!Array.isArray(value)) {
    invalid("items must be an array.");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      invalid(`items[${index}] must be an object.`);
    }

    return {
      productId: requiredString(item.productId, `items[${index}].productId`),
      sku:
        item.sku === null || item.sku === undefined
          ? null
          : requiredString(item.sku, `items[${index}].sku`),
      name: requiredString(item.name, `items[${index}].name`),
      quantity: positiveInteger(item.quantity, `items[${index}].quantity`),
      unitPrice: nonNegativeNumber(item.unitPrice, `items[${index}].unitPrice`)
    };
  });
}

export class MockCommerceAdapter implements CommerceAdapter {
  normalizeOrder(payload: unknown): NormalizedOrder {
    if (!isRecord(payload)) {
      invalid("Order request must be a JSON object.");
    }

    const externalOrderId = requiredString(payload.externalOrderId, "externalOrderId");
    const externalCustomerId = requiredString(
      payload.externalCustomerId,
      "externalCustomerId"
    );
    const status = payload.status;
    if (typeof status !== "string" || !ORDER_STATUSES.includes(status as OrderStatus)) {
      invalid("status must be one of pending, paid, cancelled, or refunded.");
    }

    const amount = nonNegativeNumber(payload.amount, "amount");
    const items = normalizeItems(payload.items);
    const invoiceNumber =
      payload.invoiceNumber === null || payload.invoiceNumber === undefined
        ? null
        : requiredString(payload.invoiceNumber, "invoiceNumber");
    const orderedAt = nowIso();
    const paidAt = status === "paid" ? orderedAt : null;
    const invoiceIssued = invoiceNumber !== null;

    return {
      source: "mock",
      externalOrderId,
      status: status as OrderStatus,
      customer: {
        provider: "mock",
        externalCustomerId
      },
      currency: "TWD",
      amount: {
        subtotal: amount,
        discount: 0,
        total: amount
      },
      items: items.map((item) => ({
        productId: item.productId,
        sku: item.sku ?? null,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice
      })),
      invoice: {
        invoiceNumber,
        status: invoiceIssued ? "issued" : "none",
        issuedAt: invoiceIssued ? paidAt ?? orderedAt : null
      },
      orderedAt,
      paidAt,
      sourceCreatedAt: orderedAt,
      sourceUpdatedAt: paidAt ?? orderedAt
    };
  }
}
