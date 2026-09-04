import { Request, Response } from "express";
import { ApplicationError } from "../domain/order/order.errors";
import { MockCommerceAdapter } from "../integrations/commerce/mock/mockCommerceAdapter";
import { CustomerRepositoryPort } from "../repositories/customerRepository";
import { OrderRepositoryPort } from "../repositories/orderRepository";
import { CustomerService } from "../services/customerService";
import { OrderProcessor } from "../services/orderProcessor";
import { createMockCustomer } from "./dev/createMockCustomer";
import { createMockOrder } from "./dev/createMockOrder";
import { getMockCustomer } from "./dev/getMockCustomer";
import { getMockOrders } from "./dev/getMockOrders";
import { listMockCustomers } from "./dev/listMockCustomers";
import { sendError } from "./response";

export interface ApiDependencies {
  customerService: CustomerService;
  orderProcessor: OrderProcessor;
  mockCommerceAdapter: MockCommerceAdapter;
  orderRepository: OrderRepositoryPort;
  devAdminEnabled: boolean;
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
    if (request.method === "OPTIONS") {
      response.status(204).send("");
      return;
    }

    if (!dependencies.devAdminEnabled) {
      sendError(
        response,
        new ApplicationError("DEV_ADMIN_DISABLED", "Development admin is disabled.")
      );
      return;
    }

    const path = devPath(requestPath(request));

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
      await getMockCustomer(request, response, dependencies.customerService, userId);
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

    sendError(response, new ApplicationError("INVALID_ORDER", "API route not found."), 404);
  };
}
