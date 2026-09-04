export type UserStatus = "active" | "inactive";

export interface User {
  id: string;
  displayName: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedCustomer {
  provider: string;
  externalCustomerId: string;
}

export interface ExternalIdentity {
  id: string;
  userId: string;
  provider: string;
  externalId: string;
  createdAt: string;
  updatedAt: string;
}
