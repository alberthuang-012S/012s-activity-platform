import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { createApiHandler } from "./api/api";
import { getRuntimeConfig } from "./config/environment";
import { ActivityLedgerRepository } from "./repositories/activityLedgerRepository";
import { ActivityProcessRepository } from "./repositories/activityProcessRepository";
import { CampaignRepository } from "./repositories/campaignRepository";
import { CustomerRepository } from "./repositories/customerRepository";
import { EntitlementRepository } from "./repositories/entitlementRepository";
import { IntegrationEventRepository } from "./repositories/integrationEventRepository";
import { OrderRepository } from "./repositories/orderRepository";
import { SessionRepository } from "./repositories/sessionRepository";
import { WalletRepository } from "./repositories/walletRepository";
import { createActivityEngine } from "./services/activityEngine";
import { ActivityQueryService } from "./services/activityQueryService";
import { CampaignService } from "./services/campaignService";
import { CustomerService } from "./services/customerService";
import { createOrderProcessor } from "./services/orderProcessor";
import { SessionService } from "./services/sessionService";
import { WalletService } from "./services/walletService";
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
const campaignRepository = new CampaignRepository(database);
const activityProcessRepository = new ActivityProcessRepository(database);
const entitlementRepository = new EntitlementRepository(database);
const activityLedgerRepository = new ActivityLedgerRepository(database);
const walletRepository = new WalletRepository(database);
const activityEngine = createActivityEngine({
  campaignRepository,
  activityProcessRepository
});
const walletService = new WalletService(walletRepository, customerRepository);
const campaignService = new CampaignService(campaignRepository);
const sessionRepository = new SessionRepository(database);
const sessionService = new SessionService(
  sessionRepository,
  customerRepository,
  runtimeConfig.devSessionTtlMinutes
);
const activityQueryService = new ActivityQueryService(
  customerService,
  walletService,
  entitlementRepository,
  activityLedgerRepository,
  activityProcessRepository,
  orderRepository,
  campaignRepository
);
const orderProcessor = createOrderProcessor({
  customerRepository,
  orderRepository,
  integrationEventRepository,
  activityEngine
});
const mockCommerceAdapter = new MockCommerceAdapter();

export const api = onRequest(
  {
    region: runtimeConfig.functionsRegion,
    cors: false
  },
  createApiHandler({
    customerService,
    orderProcessor,
    mockCommerceAdapter,
    orderRepository,
    activityEngine,
    activityQueryService,
    campaignService,
    sessionService,
    walletService,
    devAdminEnabled: runtimeConfig.devAdminEnabled,
    devSessionEnabled: runtimeConfig.devAdminEnabled,
    allowedOrigins: runtimeConfig.corsAllowedOrigins
  })
);
