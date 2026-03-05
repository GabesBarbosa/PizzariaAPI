import { Request, Response, NextFunction } from 'express';
import * as orderService from '../services/order.service';

export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await orderService.createOrder(req.body);
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
};

export const getOrdersByCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = req.params.customerId;
    const orders = await orderService.getOrdersForCustomer(customerId);
    res.json(orders);
  } catch (err) {
    next(err);
  }
};

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params.id;
    const { status } = req.body;
    const updated = await orderService.setOrderStatus(orderId, status);
    res.json(updated);
  } catch (err) {
    next(err);
  }
};
