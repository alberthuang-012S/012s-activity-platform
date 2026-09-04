import { validateCreateCustomerInput } from "../domain/customer/customer.schema";
import {
  ExternalIdentity,
  NormalizedCustomer,
  User
} from "../domain/customer/customer.types";
import { ApplicationError } from "../domain/order/order.errors";
import { StoredOrder } from "../domain/order/order.types";
import { CustomerRepositoryPort } from "../repositories/customerRepository";
import { OrderRepositoryPort } from "../repositories/orderRepository";

export interface CreateCustomerResult {
  userId: string;
  provider: string;
  externalCustomerId: string;
}

export interface CustomerProfile {
  user: User;
  externalIdentities: ExternalIdentity[];
  orders: StoredOrder[];
}

export class CustomerService {
  constructor(
    private readonly customerRepository: CustomerRepositoryPort,
    private readonly orderRepository: OrderRepositoryPort
  ) {}

  async createCustomer(input: unknown): Promise<CreateCustomerResult> {
    validateCreateCustomerInput(input);
    const customer: NormalizedCustomer = {
      provider: "mock",
      externalCustomerId: input.externalCustomerId.trim()
    };
    const result = await this.customerRepository.createUserWithExternalIdentity(
      input.displayName,
      customer
    );

    return {
      userId: result.user.id,
      provider: customer.provider,
      externalCustomerId: customer.externalCustomerId
    };
  }

  async getCustomer(userId: string): Promise<CustomerProfile> {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new ApplicationError("INVALID_CUSTOMER", "userId is required.");
    }

    const user = await this.customerRepository.getUser(userId);
    if (!user) {
      throw new ApplicationError("CUSTOMER_NOT_FOUND", "Customer could not be resolved.");
    }

    const [externalIdentities, orders] = await Promise.all([
      this.customerRepository.listExternalIdentitiesForUser(userId),
      this.orderRepository.listOrdersForUser(userId)
    ]);

    return { user, externalIdentities, orders };
  }

  async listCustomers(): Promise<User[]> {
    return this.customerRepository.listUsers();
  }
}
