import { describe, expect, it } from "vitest";
import {
  CreateUserWithIdentityResult,
  CustomerRepositoryPort
} from "../repositories/customerRepository";
import {
  IntegrationEventRepositoryPort,
  NewIntegrationEvent
} from "../repositories/integrationEventRepository";
import { OrderRepositoryPort } from "../repositories/orderRepository";
import { CustomerService } from "./customerService";
import { OrderProcessor } from "./orderProcessor";
import { ApplicationError } from "../domain/order/order.errors";
import {
  ExternalIdentity,
  NormalizedCustomer,
  User
} from "../domain/customer/customer.types";
import {
  IntegrationEvent,
  IntegrationEventError,
  IntegrationEventStatus,
  NormalizedOrder,
  StoredOrder
} from "../domain/order/order.types";
import { MockCommerceAdapter } from "../integrations/commerce/mock/mockCommerceAdapter";
import { ActivityEngine, ActivityProcessResult } from "./activityEngine";

class InMemoryCustomerRepository implements CustomerRepositoryPort {
  readonly users = new Map<string, User>();
  readonly identities = new Map<string, ExternalIdentity>();
  private nextUserId = 1;

  async createUserWithExternalIdentity(
    displayName: string,
    customer: NormalizedCustomer
  ): Promise<CreateUserWithIdentityResult> {
    const existing = [...this.identities.values()].find(
      (identity) =>
        identity.provider === customer.provider &&
        identity.externalId === customer.externalCustomerId
    );
    if (existing) {
      throw new ApplicationError(
        "EXTERNAL_CUSTOMER_ALREADY_EXISTS",
        "The external customer is already linked to a member."
      );
    }

    const timestamp = new Date().toISOString();
    const user: User = {
      id: `USR_TEST_${this.nextUserId++}`,
      displayName,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const externalIdentity: ExternalIdentity = {
      id: `${customer.provider}_${customer.externalCustomerId}`,
      userId: user.id,
      provider: customer.provider,
      externalId: customer.externalCustomerId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.users.set(user.id, user);
    this.identities.set(externalIdentity.id, externalIdentity);
    return { user, externalIdentity };
  }

  async findUserByExternalIdentity(customer: NormalizedCustomer): Promise<User | null> {
    const identity = [...this.identities.values()].find(
      (candidate) =>
        candidate.provider === customer.provider &&
        candidate.externalId === customer.externalCustomerId
    );
    return identity ? this.users.get(identity.userId) ?? null : null;
  }

  async getUser(userId: string): Promise<User | null> {
    return this.users.get(userId) ?? null;
  }

  async listExternalIdentitiesForUser(userId: string): Promise<ExternalIdentity[]> {
    return [...this.identities.values()].filter((identity) => identity.userId === userId);
  }

  async listUsers(): Promise<User[]> {
    return [...this.users.values()];
  }
}

class InMemoryOrderRepository implements OrderRepositoryPort {
  readonly orders = new Map<string, StoredOrder>();
  readonly keys = new Map<string, string>();
  private nextOrderId = 1;

  async createOrderIfNotExists(
    normalizedOrder: NormalizedOrder,
    userId: string
  ): Promise<{ order: StoredOrder; duplicated: boolean }> {
    const key = `${normalizedOrder.source}_${normalizedOrder.externalOrderId}`;
    const existingOrderId = this.keys.get(key);
    if (existingOrderId) {
      return { order: this.orders.get(existingOrderId) as StoredOrder, duplicated: true };
    }

    const timestamp = new Date().toISOString();
    const order: StoredOrder = {
      ...normalizedOrder,
      id: `ORD_TEST_${this.nextOrderId++}`,
      userId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.keys.set(key, order.id);
    this.orders.set(order.id, order);
    return { order, duplicated: false };
  }

  async listRecentOrders(): Promise<StoredOrder[]> {
    return [...this.orders.values()];
  }

  async listOrdersForUser(userId: string): Promise<StoredOrder[]> {
    return [...this.orders.values()].filter((order) => order.userId === userId);
  }
}

class InMemoryIntegrationEventRepository implements IntegrationEventRepositoryPort {
  readonly events: IntegrationEvent[] = [];
  private nextEventId = 1;

  async create(event: NewIntegrationEvent): Promise<IntegrationEvent> {
    const stored: IntegrationEvent = { id: `EVT_TEST_${this.nextEventId++}`, ...event };
    this.events.push(stored);
    return stored;
  }

  async updateStatus(
    eventId: string,
    status: IntegrationEventStatus,
    processedAt: string | null,
    error: IntegrationEventError | null
  ): Promise<void> {
    const event = this.events.find((candidate) => candidate.id === eventId);
    if (!event) throw new Error("missing event");
    event.status = status;
    event.processedAt = processedAt;
    event.error = error;
  }
}

function buildDependencies(activityEngine?: ActivityEngine) {
  const customerRepository = new InMemoryCustomerRepository();
  const orderRepository = new InMemoryOrderRepository();
  const integrationEventRepository = new InMemoryIntegrationEventRepository();
  return {
    customerRepository,
    orderRepository,
    integrationEventRepository,
    customerService: new CustomerService(customerRepository, orderRepository),
    orderProcessor: new OrderProcessor({
      customerRepository,
      orderRepository,
      integrationEventRepository,
      activityEngine
    })
  };
}

function validNormalizedOrder(externalOrderId = "TEST-ORDER-001"): NormalizedOrder {
  const adapter = new MockCommerceAdapter();
  return adapter.normalizeOrder({
    externalOrderId,
    externalCustomerId: "TEST-CUSTOMER-001",
    status: "paid",
    amount: 3380,
    items: [
      {
        productId: "PPA001",
        sku: "PPA+1",
        name: "PPA+1",
        quantity: 1,
        unitPrice: 3380
      }
    ],
    invoiceNumber: "MOCK-INV-001"
  });
}

const context = {
  provider: "mock",
  externalEventId: "MOCK-EVENT-001",
  externalOrderId: "TEST-ORDER-001"
};

describe("Phase 1 order flow", () => {
  it("creates a member and external identity", async () => {
    const dependencies = buildDependencies();
    const result = await dependencies.customerService.createCustomer({
      displayName: "測試會員 A",
      externalCustomerId: "TEST-CUSTOMER-001"
    });

    expect(result.userId).toMatch(/^USR_/);
    expect(dependencies.customerRepository.users.size).toBe(1);
    expect(dependencies.customerRepository.identities.size).toBe(1);
  });

  it("processes a normal order and writes a processed event", async () => {
    const dependencies = buildDependencies();
    const customer = await dependencies.customerService.createCustomer({
      displayName: "測試會員 A",
      externalCustomerId: "TEST-CUSTOMER-001"
    });

    const result = await dependencies.orderProcessor.processOrder(validNormalizedOrder(), {
      ...context,
      externalOrderId: "TEST-ORDER-001"
    });

    expect(result).toMatchObject({ success: true, duplicated: false, userId: customer.userId });
    expect(dependencies.orderRepository.orders.size).toBe(1);
    expect(dependencies.integrationEventRepository.events[0]).toMatchObject({
      eventType: "order.paid",
      status: "processed",
      error: null
    });
  });

  it("does not create a second order for the same source and external order", async () => {
    const dependencies = buildDependencies();
    await dependencies.customerService.createCustomer({
      displayName: "測試會員 A",
      externalCustomerId: "TEST-CUSTOMER-001"
    });
    const normalized = validNormalizedOrder();

    const first = await dependencies.orderProcessor.processOrder(normalized, context);
    const second = await dependencies.orderProcessor.processOrder(normalized, {
      ...context,
      externalEventId: "MOCK-EVENT-002"
    });

    expect(first.success).toBe(true);
    expect(second).toMatchObject({ success: false, duplicated: true, error: { code: "DUPLICATE_ORDER" } });
    expect(dependencies.orderRepository.orders.size).toBe(1);
    expect(dependencies.integrationEventRepository.events).toHaveLength(2);
    expect(dependencies.integrationEventRepository.events[1]).toMatchObject({
      status: "ignored",
      error: { code: "DUPLICATE_ORDER" }
    });
  });

  it("runs Activity Engine only for a newly created paid order", async () => {
    let calls = 0;
    const activityEngine: ActivityEngine = {
      async processOrder(order): Promise<ActivityProcessResult> {
        calls += 1;
        return {
          success: true,
          ignored: false,
          orderId: order.id,
          processedCampaigns: []
        };
      }
    };
    const dependencies = buildDependencies(activityEngine);
    await dependencies.customerService.createCustomer({
      displayName: "測試會員 A",
      externalCustomerId: "TEST-CUSTOMER-001"
    });
    const normalized = validNormalizedOrder("TEST-ORDER-002");

    await dependencies.orderProcessor.processOrder(normalized, {
      ...context,
      externalOrderId: "TEST-ORDER-002"
    });
    await dependencies.orderProcessor.processOrder(normalized, {
      ...context,
      externalOrderId: "TEST-ORDER-002",
      externalEventId: "MOCK-EVENT-002"
    });

    expect(calls).toBe(1);
  });

  it("rejects an order when the external customer does not exist", async () => {
    const dependencies = buildDependencies();
    const result = await dependencies.orderProcessor.processOrder(validNormalizedOrder(), context);

    expect(result).toMatchObject({
      success: false,
      duplicated: false,
      error: { code: "CUSTOMER_NOT_FOUND" }
    });
    expect(dependencies.orderRepository.orders.size).toBe(0);
    expect(dependencies.integrationEventRepository.events[0]).toMatchObject({
      status: "failed",
      error: { code: "CUSTOMER_NOT_FOUND" }
    });
  });

  it("rejects a normalized paid order without paidAt", async () => {
    const dependencies = buildDependencies();
    await dependencies.customerService.createCustomer({
      displayName: "測試會員 A",
      externalCustomerId: "TEST-CUSTOMER-001"
    });
    const invalidOrder = { ...validNormalizedOrder(), paidAt: null };

    const result = await dependencies.orderProcessor.processOrder(invalidOrder, context);

    expect(result).toMatchObject({
      success: false,
      error: { code: "INVALID_ORDER" }
    });
    expect(dependencies.orderRepository.orders.size).toBe(0);
    expect(dependencies.integrationEventRepository.events[0]).toMatchObject({
      status: "failed",
      error: { code: "INVALID_ORDER" }
    });
  });

  it("rejects duplicate external customers with a conflict error", async () => {
    const dependencies = buildDependencies();
    await dependencies.customerService.createCustomer({
      displayName: "測試會員 A",
      externalCustomerId: "TEST-CUSTOMER-001"
    });

    await expect(
      dependencies.customerService.createCustomer({
        displayName: "測試會員 B",
        externalCustomerId: "TEST-CUSTOMER-001"
      })
    ).rejects.toMatchObject({ code: "EXTERNAL_CUSTOMER_ALREADY_EXISTS" });
  });
});
