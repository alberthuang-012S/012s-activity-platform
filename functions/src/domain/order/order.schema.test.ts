import { describe, expect, it } from "vitest";
import { ApplicationError } from "./order.errors";
import { validateNormalizedOrder } from "./order.schema";
import { NormalizedOrder } from "./order.types";

const validOrder: NormalizedOrder = {
  source: "mock",
  externalOrderId: "TEST-ORDER-001",
  status: "paid",
  customer: {
    provider: "mock",
    externalCustomerId: "TEST-CUSTOMER-001"
  },
  currency: "TWD",
  amount: {
    subtotal: 3380,
    discount: 0,
    total: 3380
  },
  items: [
    {
      productId: "PPA001",
      sku: "PPA+1",
      name: "PPA+1",
      quantity: 1,
      unitPrice: 3380
    }
  ],
  invoice: {
    invoiceNumber: "MOCK-INV-001",
    status: "issued",
    issuedAt: "2026-09-04T02:00:00.000Z"
  },
  orderedAt: "2026-09-04T01:55:00.000Z",
  paidAt: "2026-09-04T02:00:00.000Z",
  sourceCreatedAt: "2026-09-04T01:55:00.000Z",
  sourceUpdatedAt: "2026-09-04T02:00:00.000Z"
};

describe("validateNormalizedOrder", () => {
  it("accepts the normalized order contract", () => {
    expect(() => validateNormalizedOrder(validOrder)).not.toThrow();
  });

  it("rejects a paid order without paidAt", () => {
    expect(() =>
      validateNormalizedOrder({ ...validOrder, paidAt: null })
    ).toThrowError(ApplicationError);

    try {
      validateNormalizedOrder({ ...validOrder, paidAt: null });
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_ORDER" });
    }
  });

  it("rejects a negative total", () => {
    expect(() =>
      validateNormalizedOrder({
        ...validOrder,
        amount: { ...validOrder.amount, total: -100 }
      })
    ).toThrowError(ApplicationError);
  });
});
