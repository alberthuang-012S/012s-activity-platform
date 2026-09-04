import { randomInt } from "node:crypto";
import { ApplicationError } from "../domain/order/order.errors";
import { ActorContext } from "../domain/session/session.types";
import { SLOT_GAME_CONFIG } from "../domain/game/slotGameConfig";
import { calculateSlotReward, createSlotSpinId, hashIdempotencyKey, parseIdempotencyKey } from "../domain/game/slot.schema";
import { GameResult, SlotSpinResponse, SlotSymbolId } from "../domain/game/slot.types";
import {
  ExecuteSpinInput,
  GameResultRepositoryPort
} from "../repositories/gameResultRepository";
import { dateKeyInTimeZone } from "../utils/dates";

export interface SlotGameServiceDependencies {
  gameResultRepository: GameResultRepositoryPort;
  clock?: () => Date;
  randomInt?: (max: number) => number;
}

function toResponse(gameResult: GameResult): SlotSpinResponse {
  return {
    spinId: gameResult.spinId,
    result: [...gameResult.result],
    reward: { ...gameResult.reward },
    dailyMissionBonus: gameResult.dailyMissionBonus,
    balances: { ...gameResult.balances }
  };
}

function weightedSymbol(nextRandomInt: (max: number) => number): SlotSymbolId {
  const totalWeight = SLOT_GAME_CONFIG.symbols.reduce(
    (total, symbol) => total + symbol.weight,
    0
  );
  const cursor = nextRandomInt(totalWeight);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= totalWeight) {
    throw new ApplicationError("INTERNAL_ERROR", "Server random source returned an invalid value.");
  }

  let remaining = cursor;
  for (const symbol of SLOT_GAME_CONFIG.symbols) {
    remaining -= symbol.weight;
    if (remaining < 0) {
      return symbol.id;
    }
  }
  return SLOT_GAME_CONFIG.symbols[SLOT_GAME_CONFIG.symbols.length - 1].id;
}

export function drawSlotResult(
  nextRandomInt: (max: number) => number = randomInt
): SlotSymbolId[] {
  return [
    weightedSymbol(nextRandomInt),
    weightedSymbol(nextRandomInt),
    weightedSymbol(nextRandomInt)
  ];
}

export class SlotGameService {
  private readonly clock: () => Date;
  private readonly randomInt: (max: number) => number;

  constructor(private readonly dependencies: SlotGameServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.randomInt = dependencies.randomInt ?? randomInt;
  }

  async spin(actor: ActorContext, rawIdempotencyKey: unknown): Promise<SlotSpinResponse> {
    if (!actor || typeof actor.userId !== "string" || actor.userId.trim().length === 0) {
      throw new ApplicationError("INVALID_SESSION", "A valid actor is required.");
    }

    const idempotencyKey = parseIdempotencyKey(rawIdempotencyKey);
    const spinId = createSlotSpinId(actor.userId, idempotencyKey);
    const existingResult = await this.dependencies.gameResultRepository.getGameResult(spinId);
    if (existingResult) {
      return toResponse(existingResult);
    }

    const currentTime = this.clock();
    if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
      throw new ApplicationError("INTERNAL_ERROR", "Server clock returned an invalid date.");
    }
    const result = drawSlotResult(this.randomInt);
    const input: ExecuteSpinInput = {
      spinId,
      userId: actor.userId,
      idempotencyKeyHash: hashIdempotencyKey(idempotencyKey),
      date: dateKeyInTimeZone(currentTime, SLOT_GAME_CONFIG.timezone),
      result,
      reward: calculateSlotReward(result),
      dailyMissionBonus: SLOT_GAME_CONFIG.dailyMissionBonus,
      createdAt: currentTime.toISOString()
    };
    const processed = await this.dependencies.gameResultRepository.executeSpin(input);
    return toResponse(processed.gameResult);
  }
}

export function createSlotGameService(
  dependencies: SlotGameServiceDependencies
): SlotGameService {
  return new SlotGameService(dependencies);
}
