import { ApplicationError } from "../order/order.errors";
import { isRecord } from "../../utils/validation";

export interface CreateCustomerInput {
  displayName: string;
  externalCustomerId: string;
}

export function validateCreateCustomerInput(input: unknown): asserts input is CreateCustomerInput {
  if (!isRecord(input)) {
    throw new ApplicationError("INVALID_CUSTOMER", "Customer request must be a JSON object.");
  }

  if (typeof input.displayName !== "string" || input.displayName.trim().length === 0) {
    throw new ApplicationError("INVALID_CUSTOMER", "displayName is required.");
  }

  if (
    typeof input.externalCustomerId !== "string" ||
    input.externalCustomerId.trim().length === 0
  ) {
    throw new ApplicationError("INVALID_CUSTOMER", "externalCustomerId is required.");
  }
}
