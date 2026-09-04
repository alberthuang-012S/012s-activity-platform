import { Request, Response } from "express";
import { ApplicationError } from "../domain/order/order.errors";
import { handleCors } from "./cors";
import { MockCommerceAdapter } from "../integrations/commerce/mock/mockCommerceAdapter";
import { CustomerRepositoryPort } from "../repositories/customerRepository";
import { OrderRepositoryPort } from "../repositories/orderRepository";
import { ActivityEngine } from "../services/activityEngine";
import { ActivityQueryService } from "../services/activityQueryService";
import { CampaignService } from "../services/campaignService";
import { CustomerService } from "../services/customerService";
import { OrderProcessor } from "../services/orderProcessor";
import { SessionService } from "../services/sessionService";
import { WalletService } from "../services/walletService";
import { createDevSession } from "./dev/createDevSession";
import {
  activateDevCampaign,
  createDevCampaign,
  listDevCampaigns
} from "./dev/campaigns";
import { createMockCustomer } from "./dev/createMockCustomer";
import { createMockOrder } from "./dev/createMockOrder";
import { getCustomerActivity } from "./dev/getCustomerActivity";
import { getOrderActivity } from "./dev/getOrderActivity";
import { getMockOrders } from "./dev/getMockOrders";
import { listMockCustomers } from "./dev/listMockCustomers";
import { reprocessOrderActivity } from "./dev/reprocessActivity";
import { getMyWallet } from "./me/getWallet";
import { sendError } from "./response";

export interface ApiDependencies {
  customerService: CustomerService;
  orderProcessor: OrderProcessor;
  mockCommerceAdapter: MockCommerceAdapter;
  orderRepository: OrderRepositoryPort;
  activityEngine: ActivityEngine;
  activityQueryService: ActivityQueryService;
  campaignService: CampaignService;
  sessionService: SessionService;
  walletService: WalletService;
  devAdminEnabled: boolean;
  devSessionEnabled: boolean;
  allowedOrigins: string[];
}

function requestPath(request: Request): string {
  const path = request.path || request.url || "/";
  const withoutQuery = path.split("?", 1)[0];
  return withoutQuery.endsWith("/") && withoutQuery !== "/"
    ? withoutQuery.slice(0, -1)
    : withoutQuery;
}

function devPath(path: string): string {
  return path.startsWith("/api") ? path.slice("/api".length) || "/" : path;
}

export function createApiHandler(dependencies: ApiDependencies) {
  return async (request: Request, response: Response): Promise<void> => {
    if (!handleCors(request, response, dependencies.allowedOrigins)) {
      return;
    }

    const path = devPath(requestPath(request));

    if (request.method === "GET" && path === "/me/wallet") {
      if (!dependencies.devSessionEnabled) {
        sendError(
          response,
          new ApplicationError("DEV_ADMIN_DISABLED", "Development session is disabled.")
        );
        return;
      }
      await getMyWallet(request, response, dependencies.sessionService, dependencies.walletService);
      return;
    }

    if (!path.startsWith("/dev")) {
      sendError(response, new ApplicationError("INVALID_ORDER", "API route not found."), 404);
      return;
    }

    if (!dependencies.devAdminEnabled) {
      sendError(
        response,
        new ApplicationError("DEV_ADMIN_DISABLED", "Development admin is disabled.")
      );
      return;
    }

    if (request.method === "POST" && path === "/dev/campaigns") {
      await createDevCampaign(request, response, dependencies.campaignService);
      return;
    }

    if (request.method === "GET" && path === "/dev/campaigns") {
      await listDevCampaigns(request, response, dependencies.campaignService);
      return;
    }

    if (request.method === "POST" && path.startsWith("/dev/campaigns/") && path.endsWith("/activate")) {
      const campaignId = path.slice("/dev/campaigns/".length, -"/activate".length);
      await activateDevCampaign(
        request,
        response,
        dependencies.campaignService,
        campaignId
      );
      return;
    }

    if (request.method === "POST" && path === "/dev/sessions") {
      await createDevSession(request, response, dependencies.sessionService);
      return;
    }

    if (request.method === "POST" && path === "/dev/customers") {
      await createMockCustomer(request, response, dependencies.customerService);
      return;
    }

    if (request.method === "GET" && path === "/dev/customers") {
      await listMockCustomers(request, response, dependencies.customerService);
      return;
    }

    if (request.method === "GET" && path.startsWith("/dev/customers/")) {
      const userId = path.slice("/dev/customers/".length);
      await getCustomerActivity(request, response, dependencies.activityQueryService, userId);
      return;
    }

    if (request.method === "POST" && path === "/dev/orders") {
      await createMockOrder(
        request,
        response,
        dependencies.mockCommerceAdapter,
        dependencies.orderProcessor
      );
      return;
    }

    if (request.method === "GET" && path === "/dev/orders") {
      await getMockOrders(request, response, dependencies.orderRepository);
      return;
    }

    if (
      request.method === "POST" &&
      path.startsWith("/dev/orders/") &&
      path.endsWith("/reprocess-activity")
    ) {
      const orderId = path.slice("/dev/orders/".length, -"/reprocess-activity".length);
      await reprocessOrderActivity(
        request,
        response,
        dependencies.orderRepository,
        dependencies.activityEngine,
        orderId
      );
      return;
    }

    if (request.method === "GET" && path.startsWith("/dev/orders/")) {
      const orderId = path.slice("/dev/orders/".length);
      await getOrderActivity(request, response, dependencies.activityQueryService, orderId);
      return;
    }

    sendError(response, new ApplicationError("INVALID_ORDER", "API route not found."), 404);
  };
}
