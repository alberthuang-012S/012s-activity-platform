import { Request, Response } from "express";
import { CustomerService } from "../../services/customerService";
import { sendError, sendSuccess } from "../response";

export async function listMockCustomers(
  _request: Request,
  response: Response,
  customerService: CustomerService
): Promise<void> {
  try {
    const users = await customerService.listCustomers();
    sendSuccess(response, users);
  } catch (error) {
    sendError(response, error);
  }
}
