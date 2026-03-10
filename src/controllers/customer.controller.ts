import { Request, Response, NextFunction } from 'express';
import * as customerService from '../services/customer.service';

export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await customerService.createCustomer(req.body);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
};

export const searchCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const term = req.query.q as string;
    const results = await customerService.searchCustomers(term || '');
    res.json(results);
  } catch (err) {
    next(err);
  }
};

export const getCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
    const customer = await customerService.getCustomerById(id);
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });
    res.json(customer);
  } catch (err) {
    next(err);
  }
};

export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await customerService.deleteCustomer(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await customerService.updateCustomer(req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: 'Cliente não encontrado' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};
