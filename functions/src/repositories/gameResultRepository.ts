import { Firestore } from "firebase-admin/firestore";
import { ApplicationError } from "../domain/order/order.errors";
import { ActivityBalanceType } from "../domain/activity/activity.types";
import { emptyWalletBalances, WalletBalances } from "../domain/activity/wallet.types";
import {
  GameDailyState,
  GameResult,
  SlotBalances,
  SlotSymbolId
} from "../domain/game/slot.types";
import type { SlotReward } from "../domain/game/slot.types";
import { createDeterministicId } from "../utils/ids";
import { ActivityLedgerEntry } from "../domain/activity/ledger.types";

export interface ExecuteSpinInput {
  spinId: string;
  userId: string;
  idempotencyKeyHash: string;
  date: string;
  result: SlotSymbolId[];
  reward: SlotReward;
  dailyMissionBonus: number;
  createdAt: string;
}

export interface ExecuteSpinResult {
  gameResult: GameResult;
  duplicated: boolean;
}

export interface GameResultRepositoryPort {
  getGameResult(spinId: string): Promise<GameResult | null>;
  executeSpin(input: ExecuteSpinInput): Promise<ExecuteSpinResult>;
}

function validBalance(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function readWalletBalances(value: unknown): WalletBalances {
  const defaults = emptyWalletBalances();
  if (value === undefined || value === null) {
    return defaults;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("INVALID_WALLET_BALANCE", "Wallet balances must be an object.");
  }

  const candidate = value as Record<string, unknown>;
  for (const type of Object.keys(defaults) as ActivityBalanceType[]) {
    const balance = candidate[type] ?? 0;
    if (!validBalance(balance)) {
      throw new ApplicationError(
        "INVALID_WALLET_BALANCE",
        `Wallet balance ${type} must be a non-negative integer.`
      );
    }
    defaults[type] = balance;
  }
  return defaults;
}

function slotBalances(wallet: WalletBalances): SlotBalances {
  return {
    SLOT_SPIN: wallet.SLOT_SPIN,
    POINTS: wallet.POINTS
  };
}

export class GameResultRepository implements GameResultRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async getGameResult(spinId: string): Promise<GameResult | null> {
    const snapshot = await this.db.collection("game_results").doc(spinId).get();
    return snapshot.exists ? (snapshot.data() as GameResult) : null;
  }

  async executeSpin(input: ExecuteSpinInput): Promise<ExecuteSpinResult> {
    const resultReference = this.db.collection("game_results").doc(input.spinId);
    const walletReference = this.db.collection("wallets").doc(input.userId);
    const dailyStateReference = this.db
      .collection("game_daily_states")
      .doc(`${input.userId}_${input.date}`);

    return this.db.runTransaction(async (transaction) => {
      const existingResult = await transaction.get(resultReference);
      if (existingResult.exists) {
        return {
          gameResult: existingResult.data() as GameResult,
          duplicated: true
        };
      }

      const walletSnapshot = await transaction.get(walletReference);
      const dailyStateSnapshot = await transaction.get(dailyStateReference);
      const balances = readWalletBalances(walletSnapshot.data()?.balances);

      if (balances.SLOT_SPIN < 1) {
        throw new ApplicationError(
          "SLOT_SPIN_EXHAUSTED",
          "No SLOT_SPIN entitlement is available."
        );
      }
      if (!Number.isInteger(input.reward.points) || input.reward.points < 0) {
        throw new ApplicationError("INVALID_SLOT_REQUEST", "Reward points must be a non-negative integer.");
      }
      if (!Number.isInteger(input.dailyMissionBonus) || input.dailyMissionBonus < 0) {
        throw new ApplicationError(
          "INVALID_SLOT_REQUEST",
          "Daily mission bonus must be a non-negative integer."
        );
      }

      balances.SLOT_SPIN -= 1;
      const slotSpinBalanceAfter = balances.SLOT_SPIN;
      balances.POINTS += input.reward.points;
      const rewardBalanceAfter = balances.POINTS;
      const dailyMissionBonus = dailyStateSnapshot.exists ? 0 : input.dailyMissionBonus;
      balances.POINTS += dailyMissionBonus;

      const gameResult: GameResult = {
        id: input.spinId,
        spinId: input.spinId,
        userId: input.userId,
        idempotencyKeyHash: input.idempotencyKeyHash,
        date: input.date,
        result: [...input.result],
        reward: { ...input.reward },
        dailyMissionBonus,
        balances: slotBalances(balances),
        createdAt: input.createdAt
      };
      const wallet = {
        userId: input.userId,
        balances,
        updatedAt: input.createdAt
      };
      const ledgerEntries: ActivityLedgerEntry[] = [
        {
          id: createDeterministicId("LEDGER", `${input.spinId}:SLOT_PLAY`),
          userId: input.userId,
          type: "SLOT_SPIN",
          delta: -1,
          balanceAfter: slotSpinBalanceAfter,
          reason: "SLOT_PLAY",
          sourceType: "GAME_RESULT",
          sourceId: input.spinId,
          campaignId: null,
          ruleId: null,
          createdAt: input.createdAt
        },
        {
          id: createDeterministicId("LEDGER", `${input.spinId}:SLOT_REWARD`),
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
      ];

      if (dailyMissionBonus > 0) {
        ledgerEntries.push({
          id: createDeterministicId("LEDGER", `${input.spinId}:DAILY_MISSION`),
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

      transaction.set(walletReference, wallet);
      transaction.set(dailyStateReference, {
        id: dailyStateReference.id,
        userId: input.userId,
        date: input.date,
        firstSpinCompleted: true,
        createdAt: dailyStateSnapshot.exists
          ? (dailyStateSnapshot.data() as GameDailyState).createdAt
          : input.createdAt
      } satisfies GameDailyState);
      for (const entry of ledgerEntries) {
        transaction.create(this.db.collection("activity_ledger").doc(entry.id), entry);
      }
      transaction.create(resultReference, gameResult);

      return { gameResult, duplicated: false };
    });
  }
}
