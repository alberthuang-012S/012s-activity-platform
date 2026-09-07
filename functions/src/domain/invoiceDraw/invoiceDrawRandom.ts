import { createHash } from "node:crypto";
import { ApplicationError } from "../order/order.errors";
import { InvoiceDrawPrizeSnapshot } from "./invoiceDraw.types";

const UINT64_SPACE = 1n << 64n;

export function totalInvoiceDrawWeight(prizes: readonly Pick<InvoiceDrawPrizeSnapshot, "weight">[]): number {
  let total = 0;
  for (const prize of prizes) {
    if (!Number.isSafeInteger(prize.weight) || prize.weight <= 0) {
      throw new ApplicationError("INVALID_INVOICE_DRAW_PRIZE", "Prize weight must be a positive safe integer.");
    }
    total += prize.weight;
    if (!Number.isSafeInteger(total)) {
      throw new ApplicationError("INVALID_INVOICE_DRAW_PRIZE", "Prize pool total weight is too large.");
    }
  }
  return total;
}

function cursorFromSeed(seed: Uint8Array, totalWeight: number): number {
  if (seed.length === 0) {
    throw new ApplicationError("INVALID_INVOICE_DRAW_REQUEST", "Entropy seed cannot be empty.");
  }
  const total = BigInt(totalWeight);
  const limit = UINT64_SPACE - (UINT64_SPACE % total);
  for (let counter = 0; counter < 1000; counter += 1) {
    const digest = createHash("sha256")
      .update(seed)
      .update(Buffer.from(`:${counter}`, "utf8"))
      .digest();
    const value = digest.readBigUInt64BE(0);
    if (value < limit) {
      return Number(value % total);
    }
  }
  throw new ApplicationError("INTERNAL_ERROR", "Unable to derive a secure prize cursor.");
}

export function selectInvoiceDrawPrize<T extends Pick<InvoiceDrawPrizeSnapshot, "weight">>(
  eligiblePrizes: readonly T[],
  entropySeed: Uint8Array
): T {
  if (eligiblePrizes.length === 0) {
    throw new ApplicationError("INVOICE_DRAW_POOL_EXHAUSTED", "No eligible invoice draw prize is available.");
  }
  const totalWeight = totalInvoiceDrawWeight(eligiblePrizes);
  let remaining = cursorFromSeed(entropySeed, totalWeight);
  for (const prize of eligiblePrizes) {
    remaining -= prize.weight;
    if (remaining < 0) {
      return prize;
    }
  }
  throw new ApplicationError("INTERNAL_ERROR", "Weighted prize selection did not resolve a prize.");
}
