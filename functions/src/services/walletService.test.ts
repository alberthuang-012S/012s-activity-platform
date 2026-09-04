import { describe, expect, it } from "vitest";
import { User } from "../domain/customer/customer.types";
import { Wallet } from "../domain/activity/wallet.types";
import { CustomerRepositoryPort } from "../repositories/customerRepository";
import { WalletRepositoryPort } from "../repositories/walletRepository";
import { WalletService } from "./walletService";

class FakeCustomerRepository implements Pick<CustomerRepositoryPort, "getUser"> {
  async getUser(userId: string): Promise<User | null> {
    return userId === "USR_WALLET_001"
      ? {
          id: userId,
          displayName: "Wallet User",
          status: "active",
          createdAt: "2026-09-04T00:00:00.000Z",
          updatedAt: "2026-09-04T00:00:00.000Z"
        }
      : null;
  }
}

class FakeWalletRepository implements WalletRepositoryPort {
  wallet: Wallet | null = null;

  async getWallet(_userId: string): Promise<Wallet | null> {
    return this.wallet;
  }
}

describe("Wallet read model", () => {
  it("returns zero balances before the first activity grant", async () => {
    const result = await new WalletService(
      new FakeWalletRepository(),
      new FakeCustomerRepository()
    ).getWalletForUser("USR_WALLET_001");

    expect(result).toEqual({
      userId: "USR_WALLET_001",
      balances: { SLOT_SPIN: 0, INVOICE_DRAW: 0, POINTS: 0 },
      updatedAt: null
    });
  });

  it("returns the persisted ledger-backed wallet balances", async () => {
    const repository = new FakeWalletRepository();
    repository.wallet = {
      userId: "USR_WALLET_001",
      balances: { SLOT_SPIN: 4, INVOICE_DRAW: 1, POINTS: 0 },
      updatedAt: "2026-09-04T10:00:00.000Z"
    };
    const result = await new WalletService(
      repository,
      new FakeCustomerRepository()
    ).getWalletForUser("USR_WALLET_001");

    expect(result.balances).toEqual({ SLOT_SPIN: 4, INVOICE_DRAW: 1, POINTS: 0 });
  });
});
