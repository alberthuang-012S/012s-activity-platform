import { Request, Response } from "express";
import { CustomerService } from "../../services/customerService";
import { sendError, sendSuccess } from "../response";

export async function createMockCustomer(
  request: Request,
  response: Response,
  customerService: CustomerService
): Promise<void> {
  try {
    const data = await customerService.createCustomer(request.body);
    sendSuccess(response, data, 201);
  } catch (error) {
    sendError(response, error);
  }
}
