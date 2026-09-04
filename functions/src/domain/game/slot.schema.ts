import { ApplicationError } from "../order/order.errors";
import { createHash } from "node:crypto";
import { createDeterministicId } from "../../utils/ids";
import { SLOT_GAME_CONFIG } from "./slotGameConfig";
import type { SlotRewardType } from "./slotGameConfig";
import type { SlotReward, SlotSymbolId } from "./slot.types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new ApplicationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key must be a UUID."
    );
  }
  return value.trim().toLowerCase();
}

export function createSlotSpinId(userId: string, idempotencyKey: string): string {
  return createDeterministicId("SPIN", `${userId}:${idempotencyKey}`);
}

export function hashIdempotencyKey(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex");
}

export function calculateSlotReward(result: readonly SlotSymbolId[]): SlotReward {
  if (result.length !== 3) {
    throw new ApplicationError("INVALID_SLOT_REQUEST", "A slot result must contain three symbols.");
  }

  const [first, second, third] = result;
  let type: SlotRewardType = "normal";

  if (first === "gift" && second === "gift" && third === "gift") {
    type = "jackpot";
  } else if (first === "plus1" && second === "plus1" && third === "plus1") {
    type = "plusTriple";
  } else if (first === "012s" && second === "012s" && third === "012s") {
    type = "brandTriple";
  } else if (first === second && second === third) {
    type = "triple";
  } else if (first === second || second === third || first === third) {
    type = "double";
  }

  return { type, points: SLOT_GAME_CONFIG.rewards[type] };
}
