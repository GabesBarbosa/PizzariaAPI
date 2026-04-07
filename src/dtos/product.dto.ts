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

export interface CreateVariationDTO {
  name: string;
  type: 'size' | 'addon' | 'removal' | 'custom';
  priceModifier: number;
}

export interface UpdateVariationDTO {
  name?: string;
  type?: 'size' | 'addon' | 'removal' | 'custom';
  priceModifier?: number;
}
