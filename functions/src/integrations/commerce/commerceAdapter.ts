import { NormalizedOrder } from "../../domain/order/order.types";

export interface CommerceAdapter {
  normalizeOrder(payload: unknown): NormalizedOrder;
}
