import { ApplicationError } from "../domain/order/order.errors";
import { Campaign } from "../domain/activity/campaign.types";
import { Entitlement } from "../domain/activity/entitlement.types";
import { ActivityLedgerEntry } from "../domain/activity/ledger.types";
import { ActivityProcess } from "../domain/activity/process.types";
import { WalletView } from "../domain/activity/wallet.types";
import { CustomerProfile, CustomerService } from "./customerService";
import { ActivityLedgerRepositoryPort } from "../repositories/activityLedgerRepository";
import { ActivityProcessRepositoryPort } from "../repositories/activityProcessRepository";
import { CampaignRepositoryPort } from "../repositories/campaignRepository";
import { EntitlementRepositoryPort } from "../repositories/entitlementRepository";
import { OrderRepositoryPort } from "../repositories/orderRepository";
import { WalletService } from "./walletService";
import { StoredOrder } from "../domain/order/order.types";

export interface CustomerActivityProfile extends CustomerProfile {
  wallet: WalletView;
  entitlements: Entitlement[];
  ledger: ActivityLedgerEntry[];
  activityProcesses: ActivityProcess[];
}

export interface OrderActivityDetails {
  order: StoredOrder;
  entitlements: Entitlement[];
  ledger: ActivityLedgerEntry[];
  activityProcesses: ActivityProcess[];
  campaigns: Campaign[];
}

export class ActivityQueryService {
  constructor(
    private readonly customerService: CustomerService,
    private readonly walletService: WalletService,
    private readonly entitlementRepository: EntitlementRepositoryPort,
    private readonly ledgerRepository: ActivityLedgerRepositoryPort,
    private readonly activityProcessRepository: ActivityProcessRepositoryPort,
    private readonly orderRepository: OrderRepositoryPort,
    private readonly campaignRepository: CampaignRepositoryPort
  ) {}

  async getCustomerActivityProfile(userId: string): Promise<CustomerActivityProfile> {
    const [profile, wallet, entitlements, ledger] = await Promise.all([
      this.customerService.getCustomer(userId),
      this.walletService.getWalletForUser(userId),
      this.entitlementRepository.listForUser(userId),
      this.ledgerRepository.listForUser(userId)
    ]);
    const orderIds = new Set(profile.orders.map((order) => order.id));
    const processLists = await Promise.all(
      [...orderIds].map((orderId) => this.activityProcessRepository.listForOrder(orderId))
    );
    return {
      ...profile,
      wallet,
      entitlements,
      ledger,
      activityProcesses: processLists.flat()
    };
  }

  async getOrderActivity(orderId: string): Promise<OrderActivityDetails> {
    const order = this.orderRepository.getOrder
      ? await this.orderRepository.getOrder(orderId)
      : null;
    if (!order) {
      throw new ApplicationError("ORDER_NOT_FOUND", "Order could not be resolved.");
    }

    const [entitlements, ledger, activityProcesses] = await Promise.all([
      this.entitlementRepository.listForOrder(orderId),
      this.ledgerRepository.listForOrder(orderId),
      this.activityProcessRepository.listForOrder(orderId)
    ]);
    const campaignIds = new Set([
      ...entitlements.map((entitlement) => entitlement.campaignId),
      ...activityProcesses.map((process) => process.campaignId),
      ...ledger
        .map((entry) => entry.campaignId)
        .filter((campaignId): campaignId is string => campaignId !== null)
    ]);
    const campaigns = (
      await Promise.all([...campaignIds].map((campaignId) => this.campaignRepository.getCampaign(campaignId)))
    ).filter((campaign): campaign is Campaign => campaign !== null);

    return { order, entitlements, ledger, activityProcesses, campaigns };
  }
}
