import { describe, expect, it } from "vitest";
import { ApplicationError } from "../../../domain/order/order.errors";
import { MockCommerceAdapter } from "./mockCommerceAdapter";

const adapter = new MockCommerceAdapter();

describe("MockCommerceAdapter", () => {
  it("normalizes the development order payload", () => {
    const order = adapter.normalizeOrder({
      externalOrderId: "TEST-ORDER-001",
      externalCustomerId: "TEST-CUSTOMER-001",
      status: "paid",
      amount: 3380,
      items: [
        {
          productId: "PPA001",
          sku: "PPA+1",
          name: "PPA+1",
          quantity: 1,
          unitPrice: 3380
        }
      ],
      invoiceNumber: "MOCK-INV-001"
    });

    expect(order).toMatchObject({
      source: "mock",
      externalOrderId: "TEST-ORDER-001",
      status: "paid",
      currency: "TWD",
      amount: { subtotal: 3380, discount: 0, total: 3380 },
      invoice: { invoiceNumber: "MOCK-INV-001", status: "issued" }
    });
    expect(order.paidAt).toEqual(expect.any(String));
  });

  it("rejects a negative amount before persistence", () => {
    expect(() =>
      adapter.normalizeOrder({
        externalOrderId: "TEST-ORDER-INVALID",
        externalCustomerId: "TEST-CUSTOMER-001",
        status: "paid",
        amount: -100,
        items: []
      })
    ).toThrowError(ApplicationError);

    try {
      adapter.normalizeOrder({
        externalOrderId: "TEST-ORDER-INVALID",
        externalCustomerId: "TEST-CUSTOMER-001",
        status: "paid",
        amount: -100,
        items: []
      });
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_ORDER" });
    }
  });
});
