import { ApplicationError } from "../../../domain/order/order.errors";
import { NormalizedOrder } from "../../../domain/order/order.types";
import { CommerceAdapter } from "../commerceAdapter";

/**
 * Placeholder for the future commerce integration boundary.
 * No external payload shape, SDK, credentials, or webhook behavior is defined in Phase 1.
 */
export class ShoplineCommerceAdapter implements CommerceAdapter {
  normalizeOrder(_payload: unknown): NormalizedOrder {
    throw new ApplicationError(
      "SHOPLINE_NOT_ENABLED",
      "The future commerce integration is intentionally not implemented in Phase 1."
    );
  }
}
