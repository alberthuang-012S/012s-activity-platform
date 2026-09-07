import { describe, expect, it } from "vitest";
import { ApplicationError } from "../order/order.errors";
import { selectInvoiceDrawPrize, totalInvoiceDrawWeight } from "./invoiceDrawRandom";

const prizes = [
  { prizeId: "PRIZE_A", weight: 1 },
  { prizeId: "PRIZE_B", weight: 3 },
  { prizeId: "PRIZE_C", weight: 6 }
];

describe("invoice draw weighted random selection", () => {
  it("is deterministic for the same entropy seed", () => {
    const seed = Buffer.from("phase-3a-seed");

    expect(selectInvoiceDrawPrize(prizes, seed)).toBe(selectInvoiceDrawPrize(prizes, seed));
  });

  it("selects only eligible input prizes and respects positive weights", () => {
    const selections = Array.from({ length: 32 }, (_, index) =>
      selectInvoiceDrawPrize(prizes, Buffer.from(`seed-${index}`)).prizeId
    );

    expect(totalInvoiceDrawWeight(prizes)).toBe(10);
    expect(new Set(selections)).toEqual(new Set(["PRIZE_A", "PRIZE_B", "PRIZE_C"]));
  });

  it("rejects empty pools and invalid weights", () => {
    expect(() => selectInvoiceDrawPrize([], Buffer.from("seed"))).toThrowError(
      expect.objectContaining({ code: "INVOICE_DRAW_POOL_EXHAUSTED" })
    );
    expect(() => totalInvoiceDrawWeight([{ weight: 0 }])).toThrowError(
      expect.objectContaining({ code: "INVALID_INVOICE_DRAW_PRIZE" })
    );
  });

  it("does not use an unsafe modulo result for a non-power-of-two pool", () => {
    const selected = selectInvoiceDrawPrize(
      [{ prizeId: "ONLY", weight: 7 }],
      new Uint8Array(32).fill(255)
    );

    expect(selected.prizeId).toBe("ONLY");
  });
});
