import { describe, expect, it } from "vitest";
import { calculateSlotReward, parseIdempotencyKey } from "./slot.schema";

describe("Slot game domain", () => {
  it("calculates the normal and matching-symbol rewards on the server model", () => {
    expect(calculateSlotReward(["nne", "nap", "ppa"])).toEqual({
      type: "normal",
      points: 5
    });
    expect(calculateSlotReward(["nne", "nne", "ppa"])).toEqual({
      type: "double",
      points: 10
    });
    expect(calculateSlotReward(["nne", "nne", "nne"])).toEqual({
      type: "triple",
      points: 30
    });
  });

  it("preserves the special triple reward values", () => {
    expect(calculateSlotReward(["012s", "012s", "012s"])).toEqual({
      type: "brandTriple",
      points: 50
    });
    expect(calculateSlotReward(["plus1", "plus1", "plus1"])).toEqual({
      type: "plusTriple",
      points: 100
    });
    expect(calculateSlotReward(["gift", "gift", "gift"])).toEqual({
      type: "jackpot",
      points: 300
    });
  });

  it("accepts UUID idempotency keys and rejects arbitrary client keys", () => {
    expect(parseIdempotencyKey("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(() => parseIdempotencyKey(undefined)).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REQUIRED" })
    );
    expect(() => parseIdempotencyKey("not-a-uuid")).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REQUIRED" })
    );
  });
});
