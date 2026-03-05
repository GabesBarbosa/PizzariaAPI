import * as orderRepo from '../repositories/order.repository';
import * as customerRepo from '../repositories/customer.repository';
import { CreateOrderDTO } from '../dtos/order.dto';

export const createOrder = async (data: CreateOrderDTO) => {
  // ensure customer exists
  const customer = await customerRepo.findCustomerById(data.customerId);
  if (!customer) throw new Error('Cliente não encontrado');
  return orderRepo.createOrder(data);
};

export const getOrdersForCustomer = async (customerId: string) => {
  return orderRepo.findOrdersByCustomer(customerId);
};

export const setOrderStatus = async (orderId: string, status: string) => {
  return orderRepo.updateOrderStatus(orderId, status);
};
