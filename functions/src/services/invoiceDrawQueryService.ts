import { WalletService } from "./walletService";
import { InvoiceDrawCampaignRepositoryPort } from "../repositories/invoiceDrawCampaignRepository";
import {
  InvoiceDrawResultListFilter,
  InvoiceDrawResultRepositoryPort
} from "../repositories/invoiceDrawResultRepository";
import { PrizeClaimListFilter, PrizeClaimRepositoryPort } from "../repositories/prizeClaimRepository";
import {
  InvoiceDrawResult,
  InvoiceDrawStatusResponse,
  PrizeClaim
} from "../domain/invoiceDraw/invoiceDraw.types";
import { nowIso } from "../utils/dates";

export class InvoiceDrawQueryService {
  constructor(
    private readonly campaignRepository: InvoiceDrawCampaignRepositoryPort,
    private readonly walletService: WalletService,
    private readonly resultRepository: InvoiceDrawResultRepositoryPort,
    private readonly claimRepository: PrizeClaimRepositoryPort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async getStatus(userId: string): Promise<InvoiceDrawStatusResponse> {
    const now = this.clock();
    const nowString = now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString() : nowIso();
    const [campaign, wallet] = await Promise.all([
      this.campaignRepository.getCurrentCampaign(nowString),
      this.walletService.getWalletForUser(userId)
    ]);
    const campaignView = campaign
      ? {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          startsAt: campaign.startsAt,
          endsAt: campaign.endsAt
        }
      : null;
    const canDraw = campaign !== null &&
      campaign.status === "active" &&
      Date.parse(nowString) >= Date.parse(campaign.startsAt) &&
      Date.parse(nowString) <= Date.parse(campaign.endsAt) &&
      wallet.balances.INVOICE_DRAW > 0;
    return {
      campaign: campaignView,
      balances: {
        INVOICE_DRAW: wallet.balances.INVOICE_DRAW,
        POINTS: wallet.balances.POINTS
      },
      canDraw
    };
  }

  async listUserResults(userId: string, limit?: number): Promise<InvoiceDrawResult[]> {
    const filter: InvoiceDrawResultListFilter = { userId, limit };
    return this.resultRepository.listResults(filter);
  }

  async listUserClaims(userId: string, limit?: number): Promise<PrizeClaim[]> {
    const filter: PrizeClaimListFilter = { userId, limit };
    return this.claimRepository.listClaims(filter);
  }

  async listResults(filter: InvoiceDrawResultListFilter): Promise<InvoiceDrawResult[]> {
    return this.resultRepository.listResults(filter);
  }

  async listClaims(filter: PrizeClaimListFilter): Promise<PrizeClaim[]> {
    return this.claimRepository.listClaims(filter);
  }
}
