import { ApplicationError } from "./order.errors";
import {
  NormalizedInvoice,
  NormalizedOrder,
  NormalizedOrderItem,
  OrderStatus
} from "./order.types";
import { isRecord } from "../../utils/validation";

const ORDER_STATUSES: readonly OrderStatus[] = ["pending", "paid", "cancelled", "refunded"];
const INVOICE_STATUSES: readonly NormalizedInvoice["status"][] = [
  "none",
  "pending",
  "issued",
  "voided"
];

function invalidOrder(message: string): never {
  throw new ApplicationError("INVALID_ORDER", message);
}

function requiredNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidOrder(`${field} is required.`);
  }
}

function nonNegativeNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalidOrder(`${field} must be a finite number greater than or equal to zero.`);
  }
}

function validDateString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    invalidOrder(`${field} must be a valid date string.`);
  }
}

function nullableDateString(value: unknown, field: string): asserts value is string | null {
  if (value !== null) {
    validDateString(value, field);
  }
}

function validateItem(item: unknown, index: number): asserts item is NormalizedOrderItem {
  if (!isRecord(item)) {
    invalidOrder(`items[${index}] must be an object.`);
  }

  requiredNonEmptyString(item.productId, `items[${index}].productId`);
  if (item.sku !== null && typeof item.sku !== "string") {
    invalidOrder(`items[${index}].sku must be a string or null.`);
  }
  requiredNonEmptyString(item.name, `items[${index}].name`);
  if (
    typeof item.quantity !== "number" ||
    !Number.isInteger(item.quantity) ||
    item.quantity <= 0
  ) {
    invalidOrder(`items[${index}].quantity must be an integer greater than zero.`);
  }
  nonNegativeNumber(item.unitPrice, `items[${index}].unitPrice`);
}

export function validateNormalizedOrder(order: unknown): asserts order is NormalizedOrder {
  if (!isRecord(order)) {
    invalidOrder("Order must be a JSON object.");
  }

  requiredNonEmptyString(order.source, "source");
  requiredNonEmptyString(order.externalOrderId, "externalOrderId");

  if (!isRecord(order.customer)) {
    invalidOrder("customer is required.");
  }
  requiredNonEmptyString(order.customer.provider, "customer.provider");
  requiredNonEmptyString(
    order.customer.externalCustomerId,
    "customer.externalCustomerId"
  );

  if (typeof order.status !== "string" || !ORDER_STATUSES.includes(order.status as OrderStatus)) {
    invalidOrder("status must be one of pending, paid, cancelled, or refunded.");
  }

  if (order.currency !== "TWD") {
    invalidOrder("currency must be TWD.");
  }

  if (!isRecord(order.amount)) {
    invalidOrder("amount is required.");
  }
  nonNegativeNumber(order.amount.subtotal, "amount.subtotal");
  nonNegativeNumber(order.amount.discount, "amount.discount");
  nonNegativeNumber(order.amount.total, "amount.total");

  if (!Array.isArray(order.items)) {
    invalidOrder("items must be an array.");
  }
  order.items.forEach(validateItem);

  if (!isRecord(order.invoice)) {
    invalidOrder("invoice is required.");
  }
  if (
    typeof order.invoice.status !== "string" ||
    !INVOICE_STATUSES.includes(order.invoice.status as NormalizedInvoice["status"])
  ) {
    invalidOrder("invoice.status is invalid.");
  }
  if (order.invoice.invoiceNumber !== null && typeof order.invoice.invoiceNumber !== "string") {
    invalidOrder("invoice.invoiceNumber must be a string or null.");
  }
  nullableDateString(order.invoice.issuedAt, "invoice.issuedAt");

  validDateString(order.orderedAt, "orderedAt");
  nullableDateString(order.paidAt, "paidAt");
  nullableDateString(order.sourceCreatedAt, "sourceCreatedAt");
  nullableDateString(order.sourceUpdatedAt, "sourceUpdatedAt");

  if (order.status === "paid" && order.paidAt === null) {
    invalidOrder("paidAt is required when status is paid.");
  }
}

export const validateOrder = validateNormalizedOrder;
