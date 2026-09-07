import { createHash } from "node:crypto";
import { ApplicationError } from "../order/order.errors";
import {
  INVOICE_DRAW_TIMEZONE,
  InvoiceDrawCampaign,
  InvoiceDrawPrize,
  InvoiceDrawRewardKind,
  InvoiceDrawStockMode,
  MAX_INVOICE_DRAW_PRIZES
} from "./invoiceDraw.types";
import { isRecord } from "../../utils/validation";
import { createDeterministicId } from "../../utils/ids";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateInvoiceDrawCampaignCommand {
  name: string;
  timezone: typeof INVOICE_DRAW_TIMEZONE;
  startsAt: string;
  endsAt: string;
}

export interface CreateInvoiceDrawPrizeCommand {
  code: string;
  displayName: string;
  description: string;
  rewardKind: InvoiceDrawRewardKind;
  points: number;
  weight: number;
  stockMode: InvoiceDrawStockMode;
  totalStock: number | null;
  enabled: boolean;
  displayOrder: number;
}

export type UpdateInvoiceDrawCampaignCommand = Partial<CreateInvoiceDrawCampaignCommand>;
export type UpdateInvoiceDrawPrizeCommand = Partial<CreateInvoiceDrawPrizeCommand>;

function invalidCampaign(message: string): never {
  throw new ApplicationError("INVALID_INVOICE_DRAW_CAMPAIGN", message);
}

function invalidPrize(message: string): never {
  throw new ApplicationError("INVALID_INVOICE_DRAW_PRIZE", message);
}

function requiredString(value: unknown, field: string, invalid: (message: string) => never): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${field} is required.`);
  }
  return value.trim();
}

function dateString(value: unknown, field: string): string {
  const parsed = requiredString(value, field, invalidCampaign);
  if (!Number.isFinite(Date.parse(parsed))) {
    invalidCampaign(`${field} must be a valid date string.`);
  }
  return parsed;
}

function positiveInteger(value: unknown, field: string, invalid: (message: string) => never): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    invalid(`${field} must be a positive safe integer.`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalidPrize(`${field} must be a non-negative safe integer.`);
  }
  return value as number;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    invalidPrize(`${field} must be a boolean.`);
  }
  return value;
}

function descriptionValue(value: unknown, field: string): string {
  if (typeof value !== "string") {
    invalidPrize(`${field} must be a string.`);
  }
  return value.trim();
}

export function parseCreateInvoiceDrawCampaignCommand(
  input: unknown
): CreateInvoiceDrawCampaignCommand {
  if (!isRecord(input)) {
    invalidCampaign("Campaign request must be a JSON object.");
  }
  const name = requiredString(input.name, "name", invalidCampaign);
  const timezone = input.timezone === undefined
    ? INVOICE_DRAW_TIMEZONE
    : requiredString(input.timezone, "timezone", invalidCampaign);
  if (timezone !== INVOICE_DRAW_TIMEZONE) {
    invalidCampaign(`timezone must be ${INVOICE_DRAW_TIMEZONE}.`);
  }
  const startsAt = dateString(input.startsAt, "startsAt");
  const endsAt = dateString(input.endsAt, "endsAt");
  if (Date.parse(startsAt) >= Date.parse(endsAt)) {
    invalidCampaign("startsAt must be before endsAt.");
  }
  return { name, timezone: INVOICE_DRAW_TIMEZONE, startsAt, endsAt };
}

export function parseUpdateInvoiceDrawCampaignCommand(
  input: unknown
): UpdateInvoiceDrawCampaignCommand {
  if (!isRecord(input)) {
    invalidCampaign("Campaign update must be a JSON object.");
  }
  const updates: UpdateInvoiceDrawCampaignCommand = {};
  if (input.name !== undefined) {
    updates.name = requiredString(input.name, "name", invalidCampaign);
  }
  if (input.timezone !== undefined) {
    const timezone = requiredString(input.timezone, "timezone", invalidCampaign);
    if (timezone !== INVOICE_DRAW_TIMEZONE) {
      invalidCampaign(`timezone must be ${INVOICE_DRAW_TIMEZONE}.`);
    }
    updates.timezone = INVOICE_DRAW_TIMEZONE;
  }
  if (input.startsAt !== undefined) {
    updates.startsAt = dateString(input.startsAt, "startsAt");
  }
  if (input.endsAt !== undefined) {
    updates.endsAt = dateString(input.endsAt, "endsAt");
  }
  if (Object.keys(updates).length === 0) {
    invalidCampaign("At least one campaign field is required.");
  }
  if (updates.startsAt && updates.endsAt && Date.parse(updates.startsAt) >= Date.parse(updates.endsAt)) {
    invalidCampaign("startsAt must be before endsAt.");
  }
  return updates;
}

function parseRewardKind(value: unknown): InvoiceDrawRewardKind {
  if (value !== "NONE" && value !== "POINTS" && value !== "MANUAL_PRIZE") {
    invalidPrize("rewardKind must be NONE, POINTS, or MANUAL_PRIZE.");
  }
  return value;
}

function parseStockMode(value: unknown): InvoiceDrawStockMode {
  if (value !== "UNLIMITED" && value !== "LIMITED") {
    invalidPrize("stockMode must be UNLIMITED or LIMITED.");
  }
  return value;
}

export function parseCreateInvoiceDrawPrizeCommand(
  input: unknown
): CreateInvoiceDrawPrizeCommand {
  if (!isRecord(input)) {
    invalidPrize("Prize request must be a JSON object.");
  }
  const code = requiredString(input.code, "code", invalidPrize);
  const displayName = requiredString(input.displayName, "displayName", invalidPrize);
  const description = input.description === undefined
    ? ""
    : descriptionValue(input.description, "description");
  const rewardKind = parseRewardKind(input.rewardKind);
  const points = input.points === undefined ? 0 : nonNegativeInteger(input.points, "points");
  const weight = positiveInteger(input.weight, "weight", invalidPrize);
  const stockMode = input.stockMode === undefined ? "UNLIMITED" : parseStockMode(input.stockMode);
  const totalStock = stockMode === "LIMITED"
    ? positiveInteger(input.totalStock, "totalStock", invalidPrize)
    : null;
  const enabled = input.enabled === undefined ? true : booleanValue(input.enabled, "enabled");
  const displayOrder = input.displayOrder === undefined
    ? 0
    : nonNegativeInteger(input.displayOrder, "displayOrder");

  validateRewardConfiguration(rewardKind, points);
  return {
    code,
    displayName,
    description,
    rewardKind,
    points,
    weight,
    stockMode,
    totalStock,
    enabled,
    displayOrder
  };
}

export function parseUpdateInvoiceDrawPrizeCommand(
  input: unknown
): UpdateInvoiceDrawPrizeCommand {
  if (!isRecord(input)) {
    invalidPrize("Prize update must be a JSON object.");
  }
  const updates: UpdateInvoiceDrawPrizeCommand = {};
  if (input.code !== undefined) updates.code = requiredString(input.code, "code", invalidPrize);
  if (input.displayName !== undefined) {
    updates.displayName = requiredString(input.displayName, "displayName", invalidPrize);
  }
  if (input.description !== undefined) {
    updates.description = descriptionValue(input.description, "description");
  }
  if (input.rewardKind !== undefined) updates.rewardKind = parseRewardKind(input.rewardKind);
  if (input.points !== undefined) updates.points = nonNegativeInteger(input.points, "points");
  if (input.weight !== undefined) updates.weight = positiveInteger(input.weight, "weight", invalidPrize);
  if (input.stockMode !== undefined) updates.stockMode = parseStockMode(input.stockMode);
  if (input.totalStock !== undefined) {
    updates.totalStock = input.totalStock === null
      ? null
      : positiveInteger(input.totalStock, "totalStock", invalidPrize);
  }
  if (input.enabled !== undefined) updates.enabled = booleanValue(input.enabled, "enabled");
  if (input.displayOrder !== undefined) {
    updates.displayOrder = nonNegativeInteger(input.displayOrder, "displayOrder");
  }
  if (Object.keys(updates).length === 0) {
    invalidPrize("At least one prize field is required.");
  }
  return updates;
}

export function validateRewardConfiguration(
  rewardKind: InvoiceDrawRewardKind,
  points: number
): void {
  if (rewardKind === "POINTS" && (!Number.isSafeInteger(points) || points <= 0)) {
    invalidPrize("POINTS prizes must have points greater than zero.");
  }
  if ((rewardKind === "NONE" || rewardKind === "MANUAL_PRIZE") && points !== 0) {
    invalidPrize(`${rewardKind} prizes must have points equal to zero.`);
  }
}

export function validateInvoiceDrawPrizePool(prizes: InvoiceDrawPrize[]): void {
  if (prizes.length === 0) {
    invalidPrize("At least one prize is required before activation.");
  }
  if (prizes.length > MAX_INVOICE_DRAW_PRIZES) {
    invalidPrize(`A campaign cannot contain more than ${MAX_INVOICE_DRAW_PRIZES} prizes.`);
  }

  const codes = new Set<string>();
  let enabledWeight = 0;
  for (const prize of prizes) {
    validateInvoiceDrawPrize(prize);
    if (codes.has(prize.code)) {
      invalidPrize("Prize code must be unique within a campaign.");
    }
    codes.add(prize.code);
    if (prize.enabled) {
      enabledWeight += prize.weight;
      if (!Number.isSafeInteger(enabledWeight)) {
        invalidPrize("Prize pool total weight is too large.");
      }
    }
  }
  if (!prizes.some((prize) => prize.enabled)) {
    invalidPrize("At least one prize must be enabled.");
  }
  if (enabledWeight <= 0) {
    invalidPrize("Prize pool total weight must be greater than zero.");
  }
}

export function validateInvoiceDrawPrize(prize: InvoiceDrawPrize): void {
  if (typeof prize.code !== "string" || prize.code.trim().length === 0) {
    invalidPrize("code is required.");
  }
  if (typeof prize.displayName !== "string" || prize.displayName.trim().length === 0) {
    invalidPrize("displayName is required.");
  }
  if (typeof prize.description !== "string") {
    invalidPrize("description must be a string.");
  }
  if (prize.rewardKind !== "NONE" && prize.rewardKind !== "POINTS" && prize.rewardKind !== "MANUAL_PRIZE") {
    invalidPrize("rewardKind must be NONE, POINTS, or MANUAL_PRIZE.");
  }
  if (prize.stockMode !== "UNLIMITED" && prize.stockMode !== "LIMITED") {
    invalidPrize("stockMode must be UNLIMITED or LIMITED.");
  }
  positiveInteger(prize.weight, `${prize.code}.weight`, invalidPrize);
  if (prize.stockMode === "LIMITED") {
    positiveInteger(prize.totalStock, `${prize.code}.totalStock`, invalidPrize);
  } else if (prize.totalStock !== null) {
    invalidPrize(`${prize.code}.totalStock must be null for UNLIMITED prizes.`);
  }
  if (typeof prize.enabled !== "boolean") {
    invalidPrize(`${prize.code}.enabled must be a boolean.`);
  }
  nonNegativeInteger(prize.displayOrder, `${prize.code}.displayOrder`);
  nonNegativeInteger(prize.points, `${prize.code}.points`);
  validateRewardConfiguration(prize.rewardKind, prize.points);
}

export function invoiceDrawCampaignIsAvailable(
  campaign: Pick<InvoiceDrawCampaign, "status" | "startsAt" | "endsAt">,
  now: string
): boolean {
  if (campaign.status !== "active") {
    return false;
  }
  const nowTime = Date.parse(now);
  return Number.isFinite(nowTime) && nowTime >= Date.parse(campaign.startsAt) && nowTime <= Date.parse(campaign.endsAt);
}

export function invoiceDrawCampaignsOverlap(
  left: Pick<InvoiceDrawCampaign, "startsAt" | "endsAt">,
  right: Pick<InvoiceDrawCampaign, "startsAt" | "endsAt">
): boolean {
  return Date.parse(left.startsAt) <= Date.parse(right.endsAt) &&
    Date.parse(right.startsAt) <= Date.parse(left.endsAt);
}

export function createPrizePoolFingerprint(snapshot: InvoiceDrawCampaign["prizePoolSnapshot"]): string {
  const canonical = snapshot
    .map((prize) => ({ ...prize }))
    .sort((left, right) => left.displayOrder - right.displayOrder || left.prizeId.localeCompare(right.prizeId));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function parseInvoiceDrawIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new ApplicationError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key must be a UUID.");
  }
  return value.trim().toLowerCase();
}

export function hashInvoiceDrawIdempotencyKey(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex");
}

export function createInvoiceDrawId(userId: string, idempotencyKey: string): string {
  return createDeterministicId("IDRAW", `${userId}:${idempotencyKey}`);
}
