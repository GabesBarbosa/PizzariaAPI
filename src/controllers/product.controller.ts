import { Request, Response, NextFunction } from 'express';
import * as productService from '../services/product.service';

export const listProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const products = await productService.listProducts();
    res.json(products);
  } catch (err) {
    next(err);
  }
};

export const getProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
    const product = await productService.getProduct(id);
    if (!product) return res.status(404).json({ message: 'Produto não encontrado' });
    res.json(product);
  } catch (err) {
    next(err);
  }
};

export const createProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const created = await productService.createProduct(req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
};

export const updateProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await productService.updateProduct(req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: 'Produto não encontrado' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const deleteProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await productService.deleteProduct(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const updateStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await productService.updateStock(req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: 'Produto não encontrado' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const listLowStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threshold = parseInt(String(req.query.threshold ?? '0'), 10);
    const products = await productService.listLowStock(Number.isNaN(threshold) ? 0 : threshold);
    res.json(products);
  } catch (err) {
    next(err);
  }
};

export const listVariations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const variations = await productService.listVariations(req.params.id);
    res.json(variations);
  } catch (err) {
    next(err);
  }
};

export const createVariation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const created = await productService.createVariation(req.params.id, req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
};

export const updateVariation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await productService.updateVariation(req.params.vid, req.body);
    if (!updated) return res.status(404).json({ message: 'Variação não encontrada' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const deleteVariation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await productService.deleteVariation(req.params.vid);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
