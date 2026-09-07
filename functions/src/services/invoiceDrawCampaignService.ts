import { ApplicationError } from "../domain/order/order.errors";
import {
  parseCreateInvoiceDrawCampaignCommand,
  parseCreateInvoiceDrawPrizeCommand,
  parseUpdateInvoiceDrawCampaignCommand,
  parseUpdateInvoiceDrawPrizeCommand
} from "../domain/invoiceDraw/invoiceDraw.schema";
import {
  CreateInvoiceDrawCampaignCommand,
  CreateInvoiceDrawPrizeCommand,
  UpdateInvoiceDrawCampaignCommand,
  UpdateInvoiceDrawPrizeCommand
} from "../domain/invoiceDraw/invoiceDraw.schema";
import {
  InvoiceDrawCampaign,
  InvoiceDrawCampaignDetail,
  InvoiceDrawPrize
} from "../domain/invoiceDraw/invoiceDraw.types";
import {
  InvoiceDrawCampaignRepositoryPort
} from "../repositories/invoiceDrawCampaignRepository";

export class InvoiceDrawCampaignService {
  constructor(private readonly repository: InvoiceDrawCampaignRepositoryPort) {}

  async createCampaign(input: unknown): Promise<InvoiceDrawCampaign> {
    const command: CreateInvoiceDrawCampaignCommand = parseCreateInvoiceDrawCampaignCommand(input);
    return this.repository.createCampaign(command);
  }

  async listCampaigns(): Promise<InvoiceDrawCampaignDetail[]> {
    return this.repository.listCampaignDetails();
  }

  async getCampaign(campaignId: string): Promise<InvoiceDrawCampaignDetail> {
    const detail = await this.repository.getCampaignDetail(campaignId);
    if (!detail) {
      throw new ApplicationError("INVOICE_DRAW_CAMPAIGN_NOT_FOUND", "Invoice draw campaign could not be resolved.");
    }
    return detail;
  }

  async updateCampaign(campaignId: string, input: unknown): Promise<InvoiceDrawCampaign> {
    const updates: UpdateInvoiceDrawCampaignCommand = parseUpdateInvoiceDrawCampaignCommand(input);
    return this.repository.updateCampaign(campaignId, updates);
  }

  async createPrize(campaignId: string, input: unknown): Promise<InvoiceDrawPrize> {
    const command: CreateInvoiceDrawPrizeCommand = parseCreateInvoiceDrawPrizeCommand(input);
    return this.repository.createPrize(campaignId, command);
  }

  async updatePrize(prizeId: string, input: unknown): Promise<InvoiceDrawPrize> {
    const updates: UpdateInvoiceDrawPrizeCommand = parseUpdateInvoiceDrawPrizeCommand(input);
    return this.repository.updatePrize(prizeId, updates);
  }

  async activate(campaignId: string): Promise<InvoiceDrawCampaign> {
    return this.repository.activateCampaign(campaignId);
  }

  async pause(campaignId: string): Promise<InvoiceDrawCampaign> {
    return this.repository.pauseCampaign(campaignId);
  }

  async resume(campaignId: string): Promise<InvoiceDrawCampaign> {
    return this.repository.resumeCampaign(campaignId);
  }

  async end(campaignId: string): Promise<InvoiceDrawCampaign> {
    return this.repository.endCampaign(campaignId);
  }
}
