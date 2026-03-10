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

export const listOrders = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const orders = await orderService.getAllOrders();
    res.json(orders);
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
    const orderId = parseInt(req.params.id, 10);
    const { status } = req.body;
    const updated = await orderService.setOrderStatus(orderId, status);
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const getOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await orderService.getOrderById(parseInt(req.params.id, 10));
    if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });
    res.json(order);
  } catch (err) {
    next(err);
  }
};

export const deleteOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await orderService.deleteOrder(parseInt(req.params.id, 10));
    if (!deleted) return res.status(404).json({ message: 'Pedido não encontrado' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const updateOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await orderService.updateOrder(parseInt(req.params.id, 10), req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
};
