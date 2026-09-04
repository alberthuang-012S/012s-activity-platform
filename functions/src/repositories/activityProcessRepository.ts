import { Firestore } from "firebase-admin/firestore";
import { ApplicationError } from "../domain/order/order.errors";
import { ActivityBalanceType } from "../domain/activity/activity.types";
import { Entitlement } from "../domain/activity/entitlement.types";
import { ActivityLedgerEntry } from "../domain/activity/ledger.types";
import { ActivityProcess, ActivityProcessError } from "../domain/activity/process.types";
import { Wallet, WalletBalances, emptyWalletBalances } from "../domain/activity/wallet.types";
import { nowIso } from "../utils/dates";
import { createDeterministicId } from "../utils/ids";

export interface ActivityGrantInput {
  entitlementId: string;
  ledgerId: string;
  ruleId: string;
  type: ActivityBalanceType;
  quantity: number;
}

export interface ApplyActivityInput {
  processId: string;
  orderId: string;
  userId: string;
  campaignId: string;
  grants: ActivityGrantInput[];
}

export interface ApplyActivityResult {
  process: ActivityProcess;
  wallet: Wallet;
  entitlementIds: string[];
  duplicated: boolean;
}

export interface RecordActivityFailureInput {
  processId: string;
  orderId: string;
  userId: string;
  campaignId: string;
  error: ActivityProcessError;
}

export interface ActivityProcessRepositoryPort {
  applyActivity(input: ApplyActivityInput): Promise<ApplyActivityResult>;
  recordFailure(input: RecordActivityFailureInput): Promise<ActivityProcess>;
  getProcess(processId: string): Promise<ActivityProcess | null>;
  listForOrder(orderId: string): Promise<ActivityProcess[]>;
}

function validBalance(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function readBalances(value: unknown): WalletBalances {
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

function storedWallet(userId: string, snapshotData: FirebaseFirestore.DocumentData | undefined): Wallet {
  const timestamp = nowIso();
  return {
    userId,
    balances: readBalances(snapshotData?.balances),
    updatedAt:
      typeof snapshotData?.updatedAt === "string" ? snapshotData.updatedAt : timestamp
  };
}

export class ActivityProcessRepository implements ActivityProcessRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async applyActivity(input: ApplyActivityInput): Promise<ApplyActivityResult> {
    const processReference = this.db.collection("activity_processes").doc(input.processId);
    const walletReference = this.db.collection("wallets").doc(input.userId);

    return this.db.runTransaction(async (transaction) => {
      const processSnapshot = await transaction.get(processReference);
      const walletSnapshot = await transaction.get(walletReference);

      if (processSnapshot.exists) {
        const existingProcess = processSnapshot.data() as ActivityProcess;
        if (existingProcess.status === "processed" || existingProcess.status === "processing") {
          const wallet = storedWallet(input.userId, walletSnapshot.data());
          return {
            process: existingProcess,
            wallet,
            entitlementIds: existingProcess.entitlementIds,
            duplicated: true
          };
        }
      }

      const balances = readBalances(walletSnapshot.data()?.balances);
      const timestamp = nowIso();
      const entitlements: Entitlement[] = [];
      const ledgerEntries: ActivityLedgerEntry[] = [];

      for (const grant of input.grants) {
        if (!Number.isInteger(grant.quantity) || grant.quantity <= 0) {
          throw new ApplicationError(
            "INVALID_ACTIVITY_RULE",
            "Activity grant quantity must be a positive integer."
          );
        }

        const nextBalance = balances[grant.type] + grant.quantity;
        if (!validBalance(nextBalance)) {
          throw new ApplicationError(
            "INVALID_WALLET_BALANCE",
            `Wallet balance ${grant.type} is invalid after applying the grant.`
          );
        }
        balances[grant.type] = nextBalance;

        entitlements.push({
          id: grant.entitlementId,
          userId: input.userId,
          campaignId: input.campaignId,
          ruleId: grant.ruleId,
          orderId: input.orderId,
          type: grant.type,
          quantity: grant.quantity,
          status: "active",
          createdAt: timestamp
        });
        ledgerEntries.push({
          id: grant.ledgerId,
          userId: input.userId,
          type: grant.type,
          delta: grant.quantity,
          balanceAfter: nextBalance,
          reason: "ORDER_ACTIVITY",
          sourceType: "ORDER",
          sourceId: input.orderId,
          campaignId: input.campaignId,
          ruleId: grant.ruleId,
          createdAt: timestamp
        });
      }

      const wallet: Wallet = {
        userId: input.userId,
        balances,
        updatedAt: timestamp
      };
      const previousProcess = processSnapshot.exists
        ? (processSnapshot.data() as ActivityProcess)
        : undefined;
      const process: ActivityProcess = {
        id: input.processId,
        orderId: input.orderId,
        userId: input.userId,
        campaignId: input.campaignId,
        status: "processed",
        processedAt: timestamp,
        entitlementIds: entitlements.map((entitlement) => entitlement.id),
        errorCode: null,
        error: null,
        createdAt: previousProcess?.createdAt ?? timestamp,
        updatedAt: timestamp
      };

      for (const entitlement of entitlements) {
        transaction.create(this.db.collection("entitlements").doc(entitlement.id), entitlement);
      }
      for (const entry of ledgerEntries) {
        transaction.create(this.db.collection("activity_ledger").doc(entry.id), entry);
      }
      transaction.set(walletReference, wallet);
      transaction.set(processReference, process);

      return {
        process,
        wallet,
        entitlementIds: process.entitlementIds,
        duplicated: false
      };
    });
  }

  async recordFailure(input: RecordActivityFailureInput): Promise<ActivityProcess> {
    const processReference = this.db.collection("activity_processes").doc(input.processId);
    const timestamp = nowIso();
    return this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(processReference);
      if (existingSnapshot.exists) {
        const existing = existingSnapshot.data() as ActivityProcess;
        if (existing.status === "processed") {
          return existing;
        }
      }

      const existing = existingSnapshot.exists
        ? (existingSnapshot.data() as ActivityProcess)
        : undefined;
      const failed: ActivityProcess = {
        id: input.processId,
        orderId: input.orderId,
        userId: input.userId,
        campaignId: input.campaignId,
        status: "failed",
        processedAt: null,
        entitlementIds: existing?.entitlementIds ?? [],
        errorCode: input.error.code,
        error: input.error,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      transaction.set(processReference, failed);
      return failed;
    });
  }

  async getProcess(processId: string): Promise<ActivityProcess | null> {
    const snapshot = await this.db.collection("activity_processes").doc(processId).get();
    return snapshot.exists ? (snapshot.data() as ActivityProcess) : null;
  }

  async listForOrder(orderId: string): Promise<ActivityProcess[]> {
    const snapshot = await this.db
      .collection("activity_processes")
      .where("orderId", "==", orderId)
      .get();
    return snapshot.docs
      .map((document) => document.data() as ActivityProcess)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}

export function createActivityProcessId(orderId: string, campaignId: string): string {
  return `${orderId}_${campaignId}`;
}

export function createActivityEntitlementId(processId: string, ruleId: string): string {
  return createDeterministicId("ENT", `${processId}:${ruleId}`);
}

export function createActivityLedgerId(processId: string, ruleId: string): string {
  return createDeterministicId("LEDGER", `${processId}:${ruleId}`);
}
