import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

export type EntityIdPrefix =
  | "SPEND"
  | "DRAWENTRY"
  | "USR"
  | "ORD"
  | "EVT"
  | "CAM"
  | "RULE"
  | "ACT"
  | "ENT"
  | "LEDGER"
  | "WAL"
  | "SES"
  | "SPIN"
  | "IDCAM"
  | "PRIZE"
  | "IDRAW"
  | "CLAIM";

export function createPrefixedId(prefix: EntityIdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function createExternalDocumentKey(provider: string, externalId: string): string {
  return `${encodeURIComponent(provider)}_${encodeURIComponent(externalId)}`;
}

export function createDeterministicId(prefix: EntityIdPrefix, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}
