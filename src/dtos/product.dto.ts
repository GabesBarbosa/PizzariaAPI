export interface CreateProductDTO {
  name: string;
  description?: string;
  price: number;
  category?: string;
}

export interface UpdateProductDTO {
  name?: string;
  description?: string;
  price?: number;
  category?: string;
}
