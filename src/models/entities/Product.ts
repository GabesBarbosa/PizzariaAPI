import { ProductVariation } from './ProductVariation';

export interface Product {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  createdAt?: Date;
  variations?: ProductVariation[];
}
