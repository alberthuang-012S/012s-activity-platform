import { describe, expect, it } from "vitest";
import {
  campaignsOverlap,
  parseCreateCampaignCommand
} from "./campaign.schema";

describe("Phase 2A campaign and rule validation", () => {
  it("keeps product and cumulative campaigns separate", () => {
    const base = { name:"活動", startsAt:"2026-09-01", endsAt:"2026-12-31" };
    const product = { type:"PRODUCT_QUANTITY", productIds:["PPA001"], requiredQuantity:1, grantQuantity:1 };
    const spend = { type:"CUMULATIVE_SPEND", thresholdAmount:1000, grantQuantity:1 };
    expect(parseCreateCampaignCommand({...base, category:"product", rules:[product]}).category).toBe("product");
    expect(parseCreateCampaignCommand({...base, category:"cumulative_spend", rules:[spend]}).category).toBe("cumulative_spend");
    for (const category of ["product", "cumulative_spend"]) {
      expect(()=>parseCreateCampaignCommand({...base, category, rules:[product,spend]})).toThrow();
      expect(()=>parseCreateCampaignCommand({...base, category, rules:[]})).toThrow();
    }
    expect(()=>parseCreateCampaignCommand({...base, category:"unknown", rules:[product]})).toThrow();
  });
  it("builds the default purchase rules from admin fields", () => {
    const command = parseCreateCampaignCommand({
      name: "2026 測試消費活動",
      startsAt: "2026-09-01T00:00:00+08:00",
      endsAt: "2026-12-31T23:59:59+08:00",
      thresholdAmount: 1000,
      slotSpinGrantQuantity: 1,
      invoiceDrawGrantQuantity: 1
    });

    expect(command).toMatchObject({
      type: "purchase",
      timezone: "Asia/Taipei"
    });
    expect(command.rules).toEqual([
      {
        type: "ORDER_TOTAL_MULTIPLE",
        entitlementType: "SLOT_SPIN",
        thresholdAmount: 1000,
        grantQuantity: 1,
        enabled: true
      },
      {
        type: "VALID_INVOICE",
        entitlementType: "INVOICE_DRAW",
        grantQuantity: 1,
        enabled: true
      }
    ]);
  });

  it("rejects invalid campaign dates and rule values", () => {
    expect(() =>
      parseCreateCampaignCommand({
        name: "Invalid",
        startsAt: "2026-09-02T00:00:00+08:00",
        endsAt: "2026-09-01T00:00:00+08:00",
        thresholdAmount: 0
      })
    ).toThrowError("startsAt must be before endsAt.");

    expect(() =>
      parseCreateCampaignCommand({
        name: "Invalid Rule",
        startsAt: "2026-09-01T00:00:00+08:00",
        endsAt: "2026-09-02T00:00:00+08:00",
        rules: [
          {
            type: "VALID_INVOICE",
            grantQuantity: 0
          }
        ]
      })
    ).toThrowError("rules[0].grantQuantity must be an integer greater than zero.");
  });

  it("detects overlapping active campaign windows", () => {
    expect(
      campaignsOverlap(
        { startsAt: "2026-09-01T00:00:00+08:00", endsAt: "2026-09-30T23:59:59+08:00" },
        { startsAt: "2026-09-15T00:00:00+08:00", endsAt: "2026-10-01T00:00:00+08:00" }
      )
    ).toBe(true);
    expect(
      campaignsOverlap(
        { startsAt: "2026-09-01T00:00:00+08:00", endsAt: "2026-09-30T23:59:59+08:00" },
        { startsAt: "2026-10-01T00:00:00+08:00", endsAt: "2026-10-31T23:59:59+08:00" }
      )
    ).toBe(false);
  });
});
