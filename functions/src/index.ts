import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { createApiHandler } from "./api/api";
import { getRuntimeConfig } from "./config/environment";
import { CustomerRepository } from "./repositories/customerRepository";
import { IntegrationEventRepository } from "./repositories/integrationEventRepository";
import { OrderRepository } from "./repositories/orderRepository";
import { CustomerService } from "./services/customerService";
import { createOrderProcessor } from "./services/orderProcessor";
import { MockCommerceAdapter } from "./integrations/commerce/mock/mockCommerceAdapter";

const runtimeConfig = getRuntimeConfig();
const firebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(runtimeConfig.firebaseProjectId ? { projectId: runtimeConfig.firebaseProjectId } : undefined);
const database = getFirestore(firebaseApp);

const customerRepository = new CustomerRepository(database);
const orderRepository = new OrderRepository(database);
const integrationEventRepository = new IntegrationEventRepository(database);
const customerService = new CustomerService(customerRepository, orderRepository);
const orderProcessor = createOrderProcessor({
  customerRepository,
  orderRepository,
  integrationEventRepository
});
const mockCommerceAdapter = new MockCommerceAdapter();

export const api = onRequest(
  {
    region: runtimeConfig.functionsRegion,
    cors: true
  },
  createApiHandler({
    customerService,
    orderProcessor,
    mockCommerceAdapter,
    orderRepository,
    devAdminEnabled: runtimeConfig.devAdminEnabled
  })
);
