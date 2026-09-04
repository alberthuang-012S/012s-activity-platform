import { describe, expect, it } from "vitest";
import { ApplicationError } from "../domain/order/order.errors";
import { ActivityLedgerEntry } from "../domain/activity/ledger.types";
import { emptyWalletBalances, WalletBalances } from "../domain/activity/wallet.types";
import { GameResult } from "../domain/game/slot.types";
import {
  ExecuteSpinInput,
  ExecuteSpinResult,
  GameResultRepositoryPort
} from "../repositories/gameResultRepository";
import { SlotGameService } from "./slotGameService";

class InMemoryTransactionalGameResultRepository implements GameResultRepositoryPort {
  readonly results = new Map<string, GameResult>();
  readonly wallets = new Map<string, WalletBalances>();
  readonly dailyStates = new Set<string>();
  readonly ledger: ActivityLedgerEntry[] = [];
  private transactionQueue: Promise<void> = Promise.resolve();

  async getGameResult(spinId: string): Promise<GameResult | null> {
    return this.results.get(spinId) ?? null;
  }

  async executeSpin(input: ExecuteSpinInput): Promise<ExecuteSpinResult> {
    const previousTransaction = this.transactionQueue;
    let release!: () => void;
    this.transactionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousTransaction;

    try {
      const existing = this.results.get(input.spinId);
      if (existing) {
        return { gameResult: existing, duplicated: true };
      }

      const balances = {
        ...emptyWalletBalances(),
        ...(this.wallets.get(input.userId) ?? {})
      };
      if (balances.SLOT_SPIN < 1) {
        throw new ApplicationError("SLOT_SPIN_EXHAUSTED", "No SLOT_SPIN entitlement is available.");
      }

      balances.SLOT_SPIN -= 1;
      const rewardBalanceAfter = balances.POINTS + input.reward.points;
      const dailyStateKey = `${input.userId}_${input.date}`;
      const dailyMissionBonus = this.dailyStates.has(dailyStateKey)
        ? 0
        : input.dailyMissionBonus;
      balances.POINTS = rewardBalanceAfter + dailyMissionBonus;
      const gameResult: GameResult = {
        id: input.spinId,
        spinId: input.spinId,
        userId: input.userId,
        idempotencyKeyHash: input.idempotencyKeyHash,
        date: input.date,
        result: [...input.result],
        reward: { ...input.reward },
        dailyMissionBonus,
        balances: {
          SLOT_SPIN: balances.SLOT_SPIN,
          POINTS: balances.POINTS
        },
        createdAt: input.createdAt
      };

      this.wallets.set(input.userId, balances);
      this.dailyStates.add(dailyStateKey);
      this.ledger.push(
        {
          id: `${input.spinId}-spin`,
          userId: input.userId,
          type: "SLOT_SPIN",
          delta: -1,
          balanceAfter: balances.SLOT_SPIN,
          reason: "SLOT_PLAY",
          sourceType: "GAME_RESULT",
          sourceId: input.spinId,
          campaignId: null,
          ruleId: null,
          createdAt: input.createdAt
        },
        {
          id: `${input.spinId}-reward`,
          userId: input.userId,
          type: "POINTS",
          delta: input.reward.points,
          balanceAfter: rewardBalanceAfter,
          reason: "SLOT_REWARD",
          sourceType: "GAME_RESULT",
          sourceId: input.spinId,
          campaignId: null,
          ruleId: null,
          createdAt: input.createdAt
        }
      );
      if (dailyMissionBonus > 0) {
        this.ledger.push({
          id: `${input.spinId}-daily`,
          userId: input.userId,
          type: "POINTS",
          delta: dailyMissionBonus,
          balanceAfter: balances.POINTS,
          reason: "DAILY_MISSION",
          sourceType: "GAME_RESULT",
          sourceId: input.spinId,
          campaignId: null,
          ruleId: null,
          createdAt: input.createdAt
        });
      }
      this.results.set(input.spinId, gameResult);
      return { gameResult, duplicated: false };
    } finally {
      release();
    }
  }
}

const actor = { userId: "USR_SLOT_001", sessionId: "SES_SLOT_001" };
const firstKey = "11111111-1111-4111-8111-111111111111";
const secondKey = "22222222-2222-4222-8222-222222222222";

function createService(
  repository: InMemoryTransactionalGameResultRepository,
  randomValues = [0, 0, 0],
  now = "2026-09-04T10:00:00.000Z"
): SlotGameService {
  let index = 0;
  return new SlotGameService({
    gameResultRepository: repository,
    clock: () => new Date(now),
    randomInt: () => randomValues[index++] ?? 0
  });
}

describe("Slot Game Backend", () => {
  it("uses server weighted random and atomically decrements SLOT_SPIN", async () => {
    const repository = new InMemoryTransactionalGameResultRepository();
    repository.wallets.set("USR_SLOT_001", {
      SLOT_SPIN: 2,
      INVOICE_DRAW: 1,
      POINTS: 0
    });

    const response = await createService(repository).spin(actor, firstKey);

    expect(response.result).toEqual(["nne", "nne", "nne"]);
    expect(response.reward).toEqual({ type: "triple", points: 30 });
    expect(response.dailyMissionBonus).toBe(5);
    expect(response.balances).toEqual({ SLOT_SPIN: 1, POINTS: 35 });
    expect(repository.wallets.get(actor.userId)).toMatchObject({ SLOT_SPIN: 1, POINTS: 35 });
    expect(repository.ledger.map((entry) => [entry.type, entry.delta, entry.reason])).toEqual([
      ["SLOT_SPIN", -1, "SLOT_PLAY"],
      ["POINTS", 30, "SLOT_REWARD"],
      ["POINTS", 5, "DAILY_MISSION"]
    ]);
  });

  it("does not spend a spin when the wallet is exhausted", async () => {
    const repository = new InMemoryTransactionalGameResultRepository();
    repository.wallets.set("USR_SLOT_001", {
      SLOT_SPIN: 0,
      INVOICE_DRAW: 0,
      POINTS: 7
    });

    await expect(createService(repository).spin(actor, firstKey)).rejects.toMatchObject({
      code: "SLOT_SPIN_EXHAUSTED"
    });
    expect(repository.results.size).toBe(0);
    expect(repository.ledger).toHaveLength(0);
    expect(repository.wallets.get(actor.userId)).toMatchObject({ SLOT_SPIN: 0, POINTS: 7 });
  });

  it("returns the same persisted result for a repeated Idempotency-Key", async () => {
    const repository = new InMemoryTransactionalGameResultRepository();
    repository.wallets.set("USR_SLOT_001", {
      SLOT_SPIN: 2,
      INVOICE_DRAW: 0,
      POINTS: 0
    });
    let randomCalls = 0;
    const service = new SlotGameService({
      gameResultRepository: repository,
      clock: () => new Date("2026-09-04T10:00:00.000Z"),
      randomInt: () => {
        randomCalls += 1;
        return 0;
      }
    });

    const first = await service.spin(actor, firstKey);
    const second = await service.spin(actor, firstKey);

    expect(second).toEqual(first);
    expect(randomCalls).toBe(3);
    expect(repository.results.size).toBe(1);
    expect(repository.ledger).toHaveLength(3);
    expect(repository.wallets.get(actor.userId)).toMatchObject({ SLOT_SPIN: 1, POINTS: 35 });
  });

  it("grants the daily bonus once and only once per Taipei date", async () => {
    const repository = new InMemoryTransactionalGameResultRepository();
    repository.wallets.set("USR_SLOT_001", {
      SLOT_SPIN: 3,
      INVOICE_DRAW: 0,
      POINTS: 0
    });
    const service = createService(repository, [0, 25, 50]);

    const first = await service.spin(actor, firstKey);
    const second = await createService(repository, [0, 25, 50]).spin(actor, secondKey);

    expect(first.dailyMissionBonus).toBe(5);
    expect(second.dailyMissionBonus).toBe(0);
    expect(repository.wallets.get(actor.userId)).toMatchObject({ SLOT_SPIN: 1, POINTS: 15 });
    expect(repository.ledger.filter((entry) => entry.reason === "DAILY_MISSION")).toHaveLength(1);
  });

  it("allows only one of two concurrent different requests to consume the last spin", async () => {
    const repository = new InMemoryTransactionalGameResultRepository();
    repository.wallets.set("USR_SLOT_001", {
      SLOT_SPIN: 1,
      INVOICE_DRAW: 0,
      POINTS: 0
    });
    const service = createService(repository);

    const settled = await Promise.allSettled([
      service.spin(actor, firstKey),
      service.spin(actor, secondKey)
    ]);
    const successful = settled.filter((result) => result.status === "fulfilled");
    const exhausted = settled.filter(
      (result) => result.status === "rejected" && result.reason?.code === "SLOT_SPIN_EXHAUSTED"
    );

    expect(successful).toHaveLength(1);
    expect(exhausted).toHaveLength(1);
    expect(repository.results.size).toBe(1);
    expect(repository.wallets.get(actor.userId)).toMatchObject({ SLOT_SPIN: 0 });
    expect(repository.ledger.filter((entry) => entry.type === "SLOT_SPIN")).toHaveLength(1);
  });

  it("uses Taipei date boundaries for the daily state key", async () => {
    const repository = new InMemoryTransactionalGameResultRepository();
    repository.wallets.set("USR_SLOT_001", {
      SLOT_SPIN: 1,
      INVOICE_DRAW: 0,
      POINTS: 0
    });
    const response = await createService(
      repository,
      [0, 0, 0],
      "2026-09-04T16:30:00.000Z"
    ).spin(actor, firstKey);

    expect(response.dailyMissionBonus).toBe(5);
    expect(repository.dailyStates.has("USR_SLOT_001_2026-09-05")).toBe(true);
  });
});
