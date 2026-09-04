import { Request, Response } from "express";
import { ApplicationError } from "../../domain/order/order.errors";
import { ActivityEngine } from "../../services/activityEngine";
import { OrderRepositoryPort } from "../../repositories/orderRepository";
import { sendError, sendSuccess } from "../response";

export async function reprocessOrderActivity(
  _request: Request,
  response: Response,
  orderRepository: OrderRepositoryPort,
  activityEngine: ActivityEngine,
  orderId: string
): Promise<void> {
  try {
    const order = orderRepository.getOrder
      ? await orderRepository.getOrder(decodeURIComponent(orderId))
      : null;
    if (!order) {
      throw new ApplicationError("ORDER_NOT_FOUND", "Order could not be resolved.");
    }
    const result = await activityEngine.processOrder(order);
    sendSuccess(response, result);
  } catch (error) {
    sendError(response, error);
  }
}
