import { Request, Response } from "express";
import { OrderRepositoryPort } from "../../repositories/orderRepository";
import { sendError, sendSuccess } from "../response";

export async function getMockOrders(
  _request: Request,
  response: Response,
  orderRepository: OrderRepositoryPort
): Promise<void> {
  try {
    const orders = await orderRepository.listRecentOrders();
    sendSuccess(
      response,
      orders.map((order) => ({
        orderId: order.id,
        externalOrderId: order.externalOrderId,
        userId: order.userId,
        amount: order.amount.total,
        status: order.status,
        createdAt: order.createdAt
      }))
    );
  } catch (error) {
    sendError(response, error);
  }
}
