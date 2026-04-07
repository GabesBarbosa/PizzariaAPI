import * as productRepo from '../repositories/product.repository';
import { CreateProductDTO, UpdateProductDTO } from '../dtos/product.dto';

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
