import { ApplicationError } from "../order/order.errors";
import {
  ActivityRule,
  NewActivityRule,
  OrderTotalMultipleRule,
  ValidInvoiceRule
} from "./activity.types";
import { CampaignType } from "./campaign.types";
import { isRecord } from "../../utils/validation";

export interface CreateCampaignCommand {
  name: string;
  type: CampaignType;
  timezone: string;
  startsAt: string;
  endsAt: string;
  rules: NewActivityRule[];
}

function invalidCampaign(message: string): never {
  throw new ApplicationError("INVALID_CAMPAIGN", message);
}

function invalidRule(message: string): never {
  throw new ApplicationError("INVALID_ACTIVITY_RULE", message);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidCampaign(`${field} is required.`);
  }
  return value.trim();
}

function validDate(value: unknown, field: string): string {
  const date = requiredString(value, field);
  if (!Number.isFinite(Date.parse(date))) {
    invalidCampaign(`${field} must be a valid date string.`);
  }
  return date;
}

function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    invalidRule(`${field} must be a finite number greater than zero.`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    invalidRule(`${field} must be an integer greater than zero.`);
  }
  return value;
}

function enabledValue(value: unknown, field: string): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "boolean") {
    invalidRule(`${field} must be a boolean.`);
  }
  return value;
}

function parseRule(value: unknown, index = 0): NewActivityRule {
  if (!isRecord(value)) {
    invalidRule(`rules[${index}] must be an object.`);
  }

  if (value.type === "ORDER_TOTAL_MULTIPLE") {
    if (value.entitlementType !== undefined && value.entitlementType !== "SLOT_SPIN") {
      invalidRule("ORDER_TOTAL_MULTIPLE entitlementType must be SLOT_SPIN.");
    }
    const rule: Omit<OrderTotalMultipleRule, "id" | "campaignId"> = {
      type: "ORDER_TOTAL_MULTIPLE",
      entitlementType: "SLOT_SPIN",
      thresholdAmount: positiveNumber(value.thresholdAmount, `rules[${index}].thresholdAmount`),
      grantQuantity: positiveInteger(value.grantQuantity, `rules[${index}].grantQuantity`),
      enabled: enabledValue(value.enabled, `rules[${index}].enabled`)
    };
    return rule;
  }

  if (value.type === "VALID_INVOICE") {
    if (value.entitlementType !== undefined && value.entitlementType !== "INVOICE_DRAW") {
      invalidRule("VALID_INVOICE entitlementType must be INVOICE_DRAW.");
    }
    const rule: Omit<ValidInvoiceRule, "id" | "campaignId"> = {
      type: "VALID_INVOICE",
      entitlementType: "INVOICE_DRAW",
      grantQuantity: positiveInteger(value.grantQuantity, `rules[${index}].grantQuantity`),
      enabled: enabledValue(value.enabled, `rules[${index}].enabled`)
    };
    return rule;
  }

  invalidRule(`rules[${index}].type must be ORDER_TOTAL_MULTIPLE or VALID_INVOICE.`);
}

function rulesFromConvenienceFields(input: Record<string, unknown>): NewActivityRule[] {
  const rules: NewActivityRule[] = [];
  const hasSlotFields =
    input.thresholdAmount !== undefined || input.slotSpinGrantQuantity !== undefined;
  if (hasSlotFields) {
    rules.push(
      parseRule({
        type: "ORDER_TOTAL_MULTIPLE",
        thresholdAmount: input.thresholdAmount ?? 1000,
        grantQuantity: input.slotSpinGrantQuantity ?? 1
      }, 0)
    );
  }

  if (input.invoiceDrawGrantQuantity !== undefined) {
    rules.push(
      parseRule(
        {
          type: "VALID_INVOICE",
          grantQuantity: input.invoiceDrawGrantQuantity
        },
        rules.length
      )
    );
  }

  return rules;
}

export function parseCreateCampaignCommand(input: unknown): CreateCampaignCommand {
  if (!isRecord(input)) {
    invalidCampaign("Campaign request must be a JSON object.");
  }

  const name = requiredString(input.name, "name");
  const type = input.type === undefined ? "purchase" : input.type;
  if (type !== "purchase") {
    invalidCampaign("Only purchase campaigns are supported in Phase 2A.");
  }

  const timezone = input.timezone === undefined ? "Asia/Taipei" : requiredString(input.timezone, "timezone");
  const startsAt = validDate(input.startsAt, "startsAt");
  const endsAt = validDate(input.endsAt, "endsAt");
  if (Date.parse(startsAt) >= Date.parse(endsAt)) {
    invalidCampaign("startsAt must be before endsAt.");
  }

  let rules: NewActivityRule[];
  if (input.rules !== undefined) {
    if (!Array.isArray(input.rules)) {
      invalidCampaign("rules must be an array.");
    }
    rules = input.rules.map(parseRule);
  } else {
    rules = rulesFromConvenienceFields(input);
  }

  return {
    name,
    type: "purchase",
    timezone,
    startsAt,
    endsAt,
    rules
  };
}

export function campaignContainsDate(campaign: {
  startsAt: string;
  endsAt: string;
  status: string;
  type: string;
}, date: string): boolean {
  if (campaign.status !== "active" || campaign.type !== "purchase") {
    return false;
  }

  const target = Date.parse(date);
  return (
    Number.isFinite(target) &&
    target >= Date.parse(campaign.startsAt) &&
    target <= Date.parse(campaign.endsAt)
  );
}

export function campaignsOverlap(
  left: { startsAt: string; endsAt: string },
  right: { startsAt: string; endsAt: string }
): boolean {
  return (
    Date.parse(left.startsAt) <= Date.parse(right.endsAt) &&
    Date.parse(right.startsAt) <= Date.parse(left.endsAt)
  );
}

export function validateActivityRule(rule: ActivityRule): void {
  parseRule(rule);
}
