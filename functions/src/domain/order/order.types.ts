export type OrderStatus = "pending" | "paid" | "cancelled" | "refunded";

export interface NormalizedOrderItem {
  productId: string;
  sku: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface NormalizedCustomerReference {
  provider: string;
  externalCustomerId: string;
}

export interface NormalizedInvoice {
  invoiceNumber: string | null;
  status: "none" | "pending" | "issued" | "voided";
  issuedAt: string | null;
}

export interface NormalizedOrder {
  source: string;
  externalOrderId: string;
  status: OrderStatus;
  customer: NormalizedCustomerReference;
  currency: "TWD";
  amount: {
    subtotal: number;
    discount: number;
    total: number;
  };
  items: NormalizedOrderItem[];
  invoice: NormalizedInvoice;
  orderedAt: string;
  paidAt: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
}

export interface StoredOrder extends NormalizedOrder {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export type Order = StoredOrder;

export type IntegrationEventStatus =
  | "received"
  | "processing"
  | "processed"
  | "ignored"
  | "failed";

export interface IntegrationEventError {
  code: string;
  message: string;
}

export interface IntegrationEvent {
  id: string;
  provider: string;
  eventType: string;
  externalEventId: string;
  externalOrderId: string;
  status: IntegrationEventStatus;
  receivedAt: string;
  processedAt: string | null;
  error: IntegrationEventError | null;
}

export interface OrderEventContext {
  provider: string;
  externalEventId: string;
  externalOrderId: string;
  eventType?: string;
}
