import { ProductVariation } from './ProductVariation';

export interface Product {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  /** NULL = produto sem controle de estoque (sempre disponível); 0 = esgotado. */
  stockQuantity?: number | null;
  createdAt?: Date;
  variations?: ProductVariation[];
}
