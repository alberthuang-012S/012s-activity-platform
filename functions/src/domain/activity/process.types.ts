import { ActivityProcessStatus } from "./activity.types";

export interface ActivityProcessError {
  code: string;
  message: string;
}

export interface ActivityProcess {
  id: string;
  orderId: string;
  userId: string;
  campaignId: string;
  status: ActivityProcessStatus;
  processedAt: string | null;
  entitlementIds: string[];
  errorCode: string | null;
  error: ActivityProcessError | null;
  createdAt: string;
  updatedAt: string;
}
