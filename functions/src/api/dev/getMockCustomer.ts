import { Request, Response } from "express";
import { CustomerService } from "../../services/customerService";
import { sendError, sendSuccess } from "../response";

export async function getMockCustomer(
  request: Request,
  response: Response,
  customerService: CustomerService,
  userId: string
): Promise<void> {
  try {
    const data = await customerService.getCustomer(decodeURIComponent(userId));
    sendSuccess(response, data);
  } catch (error) {
    sendError(response, error);
  }
}
