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
