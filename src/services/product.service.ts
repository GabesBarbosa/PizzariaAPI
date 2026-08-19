import * as productRepo from '../repositories/product.repository';
import { CreateProductDTO, UpdateProductDTO, StockAdjustmentDTO } from '../dtos/product.dto';
import { HttpError } from '../utils/errors';

export const listProducts = async () => {
  return productRepo.getAllProducts();
};

export const getProduct = async (id: string) => {
  return productRepo.getProductById(id);
};

export const createProduct = async (data: CreateProductDTO) => {
  // business validations could go here
  return productRepo.createProduct(data);
};

export const updateProduct = async (id: string, data: UpdateProductDTO) => {
  return productRepo.updateProduct(id, data);
};

export const deleteProduct = async (id: string) => {
  return productRepo.deleteProduct(id);
};

/**
 * Ajusta o estoque de um produto: `delta` soma/subtrai, `stockQuantity` define o
 * valor absoluto (null desliga o controle e o produto volta a ser sempre disponível).
 */
export const updateStock = async (id: string, data: StockAdjustmentDTO) => {
  const product = await productRepo.getProductById(id);
  if (!product) return null;

  if (typeof data.delta === 'number' && data.delta !== 0) {
    if (product.stockQuantity === null) {
      throw new HttpError('Produto não controla estoque. Defina uma quantidade inicial antes de ajustar.');
    }
    return productRepo.adjustStock(id, data.delta);
  }

  if (data.stockQuantity !== undefined) {
    return productRepo.setStock(id, data.stockQuantity);
  }

  throw new HttpError('Informe "stockQuantity" ou "delta".');
};

export const listLowStock = async (threshold = 0) => {
  return productRepo.getLowStockProducts(threshold);
};

export const listVariations = async (productId: string) => {
  return productRepo.getVariationsByProduct(productId);
};

export const createVariation = async (productId: string, data: import('../dtos/product.dto').CreateVariationDTO) => {
  return productRepo.createVariation(productId, data);
};

export const updateVariation = async (variationId: string, data: import('../dtos/product.dto').UpdateVariationDTO) => {
  return productRepo.updateVariation(variationId, data);
};

export const deleteVariation = async (variationId: string) => {
  return productRepo.deleteVariation(variationId);
};
