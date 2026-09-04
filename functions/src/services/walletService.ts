import { ApplicationError } from "../domain/order/order.errors";
import { User } from "../domain/customer/customer.types";
import { WalletView, emptyWalletBalances } from "../domain/activity/wallet.types";
import { CustomerRepositoryPort } from "../repositories/customerRepository";
import { WalletRepositoryPort } from "../repositories/walletRepository";

export class WalletService {
  constructor(
    private readonly walletRepository: WalletRepositoryPort,
    private readonly customerRepository?: CustomerRepositoryPort
  ) {}

  async getWalletForUser(userId: string): Promise<WalletView> {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new ApplicationError("INVALID_CUSTOMER", "userId is required.");
    }

    if (this.customerRepository) {
      const user: User | null = await this.customerRepository.getUser(userId);
      if (!user) {
        throw new ApplicationError("CUSTOMER_NOT_FOUND", "Customer could not be resolved.");
      }
    }

    const wallet = await this.walletRepository.getWallet(userId);
    if (!wallet) {
      return {
        userId,
        balances: emptyWalletBalances(),
        updatedAt: null
      };
    }
    return wallet;
  }
}
