import { describe, expect, it } from "vitest";
import { ApplicationError } from "../order/order.errors";
import {
  createInvoiceDrawId,
  hashInvoiceDrawIdempotencyKey,
  invoiceDrawCampaignIsAvailable,
  invoiceDrawCampaignsOverlap,
  parseCreateInvoiceDrawPrizeCommand,
  parseInvoiceDrawIdempotencyKey,
  validateInvoiceDrawPrizePool
} from "./invoiceDraw.schema";
import { InvoiceDrawPrize } from "./invoiceDraw.types";

function prize(overrides: Partial<InvoiceDrawPrize> = {}): InvoiceDrawPrize {
  return {
    id: "PRIZE_001",
    campaignId: "IDCAM_001",
    code: "NONE_001",
    displayName: "No prize",
    description: "",
    rewardKind: "NONE",
    points: 0,
    weight: 1,
    stockMode: "UNLIMITED",
    totalStock: null,
    enabled: true,
    displayOrder: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

describe("invoice draw campaign and prize validation", () => {
  it("accepts the fixed timezone and optional empty descriptions", () => {
    expect(parseCreateInvoiceDrawPrizeCommand({
      code: "NONE",
      displayName: "No prize",
      description: "",
      rewardKind: "NONE",
      weight: 1
    })).toMatchObject({ description: "", points: 0, stockMode: "UNLIMITED" });
  });

  it("enforces reward and stock configuration", () => {
    expect(() => parseCreateInvoiceDrawPrizeCommand({
      code: "POINTS",
      displayName: "Points",
      rewardKind: "POINTS",
      points: 0,
      weight: 1
    })).toThrowError(expect.objectContaining({ code: "INVALID_INVOICE_DRAW_PRIZE" }));

    expect(() => parseCreateInvoiceDrawPrizeCommand({
      code: "LIMITED",
      displayName: "Limited",
      rewardKind: "MANUAL_PRIZE",
      weight: 1,
      stockMode: "LIMITED"
    })).toThrowError(expect.objectContaining({ code: "INVALID_INVOICE_DRAW_PRIZE" }));
  });

  it("requires an enabled prize, unique codes, and a positive pool", () => {
    expect(() => validateInvoiceDrawPrizePool([prize({ enabled: false })])).toThrowError(
      expect.objectContaining({ code: "INVALID_INVOICE_DRAW_PRIZE" })
    );
    expect(() => validateInvoiceDrawPrizePool([prize(), prize({ id: "PRIZE_002" })])).toThrowError(
      expect.objectContaining({ code: "INVALID_INVOICE_DRAW_PRIZE" })
    );
  });

  it("checks campaign time and overlap boundaries", () => {
    const campaign = {
      status: "active" as const,
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-09-30T23:59:59.000Z"
    };
    expect(invoiceDrawCampaignIsAvailable(campaign, "2026-09-15T00:00:00.000Z")).toBe(true);
    expect(invoiceDrawCampaignIsAvailable(campaign, "2026-10-01T00:00:00.000Z")).toBe(false);
    expect(invoiceDrawCampaignsOverlap(
      { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-10T00:00:00.000Z" },
      { startsAt: "2026-09-10T00:00:00.000Z", endsAt: "2026-09-20T00:00:00.000Z" }
    )).toBe(true);
  });

  it("requires UUID idempotency keys and creates deterministic draw ids", () => {
    const key = "11111111-1111-4111-8111-111111111111";
    expect(parseInvoiceDrawIdempotencyKey(key)).toBe(key);
    expect(createInvoiceDrawId("USR_001", key)).toBe(createInvoiceDrawId("USR_001", key));
    expect(hashInvoiceDrawIdempotencyKey(key)).toHaveLength(64);
    expect(() => parseInvoiceDrawIdempotencyKey("not-a-uuid")).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REQUIRED" })
    );
  });
});
