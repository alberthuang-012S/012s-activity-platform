import { randomUUID } from "node:crypto";

export type EntityIdPrefix = "USR" | "ORD" | "EVT";

export function createPrefixedId(prefix: EntityIdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function createExternalDocumentKey(provider: string, externalId: string): string {
  return `${encodeURIComponent(provider)}_${encodeURIComponent(externalId)}`;
}
