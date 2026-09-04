import { ActivityBalanceType } from "./activity.types";

export type WalletBalances = Record<ActivityBalanceType, number>;

export interface Wallet {
  userId: string;
  balances: WalletBalances;
  updatedAt: string;
}

export interface WalletView {
  userId: string;
  balances: WalletBalances;
  updatedAt: string | null;
}

export function emptyWalletBalances(): WalletBalances {
  return {
    SLOT_SPIN: 0,
    INVOICE_DRAW: 0,
    POINTS: 0
  };
}
