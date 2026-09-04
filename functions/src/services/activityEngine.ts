import * as logger from "firebase-functions/logger";
import { ApplicationError, toApplicationError } from "../domain/order/order.errors";
import {
  ActivityGrant,
  ActivityRule,
  ValidInvoiceRule
} from "../domain/activity/activity.types";
import { campaignContainsDate } from "../domain/activity/campaign.schema";
import { Campaign } from "../domain/activity/campaign.types";
import { ActivityProcess } from "../domain/activity/process.types";
import { Wallet } from "../domain/activity/wallet.types";
import { Order } from "../domain/order/order.types";
import { CampaignRepositoryPort } from "../repositories/campaignRepository";
import {
  ActivityProcessRepositoryPort,
  createActivityEntitlementId,
  createActivityLedgerId,
  createActivityProcessId
} from "../repositories/activityProcessRepository";

export interface ActivityCampaignProcessResult {
  campaignId: string;
  processId: string;
  entitlementIds: string[];
  duplicated: boolean;
  wallet: Wallet;
  process: ActivityProcess;
}

export interface ActivityProcessResult {
  success: boolean;
  ignored: boolean;
  orderId: string;
  processedCampaigns: ActivityCampaignProcessResult[];
}

export interface ActivityEngine {
  processOrder(order: Order): Promise<ActivityProcessResult>;
}

export interface ActivityEngineDependencies {
  campaignRepository: CampaignRepositoryPort;
  activityProcessRepository: ActivityProcessRepositoryPort;
}

export function evaluateRules(order: Order, rules: ActivityRule[]): ActivityGrant[] {
  const grants: ActivityGrant[] = [];
  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    if (rule.type === "ORDER_TOTAL_MULTIPLE") {
      const quantity = Math.floor(order.amount.total / rule.thresholdAmount) * rule.grantQuantity;
      if (quantity > 0) {
        grants.push({ ruleId: rule.id, type: rule.entitlementType, quantity });
      }
      continue;
    }

    if (isValidInvoiceRuleSatisfied(order, rule)) {
      grants.push({ ruleId: rule.id, type: rule.entitlementType, quantity: rule.grantQuantity });
    }
  }
  return grants;
}

function isValidInvoiceRuleSatisfied(order: Order, _rule: ValidInvoiceRule): boolean {
  return (
    order.status === "paid" &&
    order.invoice.status === "issued" &&
    typeof order.invoice.invoiceNumber === "string" &&
    order.invoice.invoiceNumber.trim().length > 0
  );
}

function matchingCampaigns(order: Order, campaigns: Campaign[]): Campaign[] {
  if (!order.paidAt) {
    return [];
  }
  return campaigns.filter((campaign) => campaignContainsDate(campaign, order.paidAt as string));
}

export class ActivityEngineService implements ActivityEngine {
  constructor(private readonly dependencies: ActivityEngineDependencies) {}

  async processOrder(order: Order): Promise<ActivityProcessResult> {
    if (order.status !== "paid" || order.paidAt === null) {
      return {
        success: true,
        ignored: true,
        orderId: order.id,
        processedCampaigns: []
      };
    }

    const campaigns = matchingCampaigns(
      order,
      await this.dependencies.campaignRepository.listActivePurchaseCampaigns()
    );
    const processedCampaigns: ActivityCampaignProcessResult[] = [];

    for (const campaign of campaigns) {
      const processId = createActivityProcessId(order.id, campaign.id);
      try {
        const rules = await this.dependencies.campaignRepository.listRulesForCampaign(campaign.id);
        const grants = evaluateRules(order, rules);
        const result = await this.dependencies.activityProcessRepository.applyActivity({
          processId,
          orderId: order.id,
          userId: order.userId,
          campaignId: campaign.id,
          grants: grants.map((grant) => ({
            entitlementId: createActivityEntitlementId(processId, grant.ruleId),
            ledgerId: createActivityLedgerId(processId, grant.ruleId),
            ruleId: grant.ruleId,
            type: grant.type,
            quantity: grant.quantity
          }))
        });
        processedCampaigns.push({
          campaignId: campaign.id,
          processId,
          entitlementIds: result.entitlementIds,
          duplicated: result.duplicated,
          wallet: result.wallet,
          process: result.process
        });
      } catch (error) {
        const cause = toApplicationError(error, "ACTIVITY_PROCESSING_FAILED");
        try {
          await this.dependencies.activityProcessRepository.recordFailure({
            processId,
            orderId: order.id,
            userId: order.userId,
            campaignId: campaign.id,
            error: { code: cause.code, message: cause.message }
          });
        } catch (failureError) {
          const failure = toApplicationError(failureError, "ACTIVITY_PROCESSING_FAILED");
          logger.error("activity_process_failure_record_failed", {
            orderId: order.id,
            campaignId: campaign.id,
            processId,
            errorCode: failure.code
          });
        }

        logger.error("activity_processing_failed", {
          orderId: order.id,
          userId: order.userId,
          campaignId: campaign.id,
          processId,
          errorCode: cause.code
        });
        throw new ApplicationError(
          "ACTIVITY_PROCESSING_FAILED",
          "Activity processing failed.",
          undefined,
          cause
        );
      }
    }

    return {
      success: true,
      ignored: false,
      orderId: order.id,
      processedCampaigns
    };
  }
}

export function createActivityEngine(
  dependencies: ActivityEngineDependencies
): ActivityEngineService {
  return new ActivityEngineService(dependencies);
}
